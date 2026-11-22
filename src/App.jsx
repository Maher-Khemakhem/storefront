import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  assetUrl,
  clearSession,
  formatMoney,
  quantityNumber,
  readSession,
  saveSession,
} from "./api";
import { paymentLimitMessage, quantityRequest, saveCartQuantities } from "./checkout.js";
import { formatDateTime, formatQuantity, formatVatRate } from "./shared/format.js";
import { orderStatus } from "./shared/orderStatus.js";
import { OrderProgress, OrderStatusBadge } from "./shared/OrderStatus.jsx";

const EMPTY_CART = { items: [], subtotal: "0.000" };
const VIEWS = ["shop", "cart", "orders"];
const SORTS = ["featured", "price-asc", "price-desc", "name"];
// « Plus que N » n’est affiché que d’après les vrais stocks de l’ERP, sous ces seuils.
const LOW_STOCK = { EACH: 5, WEIGHT: 2 };

const plural = (count, one, many) => (count > 1 ? many : one);
const productsLabel = (count) => `${count} ${plural(count, "produit", "produits")}`;
const euro = (cents) => (cents / 100).toFixed(2).replace(".", ",");

/** Vue, recherche, rayon, tri et filtre de stock vivent dans l’URL : liens partageables et bouton retour. */
function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    page: VIEWS.includes(params.get("view")) ? params.get("view") : "shop",
    search: params.get("q") || "",
    family: params.get("department") || "",
    sort: SORTS.includes(params.get("sort")) ? params.get("sort") : "featured",
    inStockOnly: params.get("stock") === "1",
  };
}

function writeUrlState(state, { push = false } = {}) {
  const params = new URLSearchParams();
  if (state.page !== "shop") params.set("view", state.page);
  if (state.page === "shop") {
    if (state.search.trim()) params.set("q", state.search.trim());
    if (state.family) params.set("department", state.family);
    if (state.sort !== "featured") params.set("sort", state.sort);
    if (state.inStockOnly) params.set("stock", "1");
  }
  const url = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  window.history[push ? "pushState" : "replaceState"]({}, "", url);
}

function unitWord(unitType) {
  return unitType === "WEIGHT" ? "kg" : "unité";
}

function App() {
  const initial = useRef(readUrlState()).current;
  const [session, setSession] = useState(readSession);
  const [page, setPageState] = useState(initial.page);
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [productError, setProductError] = useState("");
  const productRequest = useRef(0);
  const mainRef = useRef(null);
  const previousPage = useRef(page);
  const [search, setSearch] = useState(initial.search);
  const [family, setFamily] = useState(initial.family);
  const [sort, setSort] = useState(initial.sort);
  const [inStockOnly, setInStockOnly] = useState(initial.inStockOnly);
  const [cart, setCart] = useState(EMPTY_CART);
  const [orders, setOrders] = useState([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingCart, setLoadingCart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeConfig, setStripeConfig] = useState(null);

  const setPage = useCallback((next) => {
    setPageState(next);
    writeUrlState({ page: next, search, family, sort, inStockOnly }, { push: true });
  }, [search, family, sort, inStockOnly]);

  // Les filtres restent dans l’URL sans ajouter une entrée d’historique à chaque frappe.
  useEffect(() => {
    if (page === "shop") writeUrlState({ page, search, family, sort, inStockOnly });
  }, [page, search, family, sort, inStockOnly]);

  const loadProducts = useCallback(async (query = "", familyId = "") => {
    const requestId = ++productRequest.current;
    setLoadingProducts(true);
    setProductError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (familyId) params.set("familyId", familyId);
      const result = await apiRequest(`/api/store/products${params.toString() ? `?${params}` : ""}`);
      if (requestId !== productRequest.current) return;
      setProducts(result || []);
      if (!query.trim() && !familyId) {
        setFamilies([...new Map((result || []).filter((product) => product.familyId).map((product) => [product.familyId, product.familyName])).entries()]);
      }
    } catch (error) {
      if (requestId === productRequest.current) setProductError(error.message);
    } finally {
      if (requestId === productRequest.current) setLoadingProducts(false);
    }
  }, []);

  // Les rayons ont besoin de la liste complète même quand la page s’ouvre sur une URL filtrée.
  useEffect(() => {
    if (!initial.search && !initial.family) return;
    apiRequest("/api/store/products")
      .then((result) => setFamilies([...new Map((result || []).filter((product) => product.familyId).map((product) => [product.familyId, product.familyName])).entries()]))
      .catch(() => {});
  }, [initial]);

  useEffect(() => {
    function handlePopState() {
      const next = readUrlState();
      setPageState(next.page);
      setSearch(next.search);
      setFamily(next.family);
      setSort(next.sort);
      setInStockOnly(next.inStockOnly);
      loadProducts(next.search, next.family);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [loadProducts]);

  useEffect(() => {
    document.title = `${page === "cart" ? "Votre panier" : page === "orders" ? "Vos commandes" : "Faire vos courses"} | Marché Central`;
    if (previousPage.current !== page) {
      window.scrollTo({ top: 0, behavior: "instant" });
      mainRef.current?.focus({ preventScroll: true });
      previousPage.current = page;
    }
  }, [page]);

  useEffect(() => { setAuthError(""); }, [authOpen, authMode]);

  const handleLogout = useCallback(() => {
    clearSession();
    setSession(null);
    setOrders([]);
    setOrdersLoaded(false);
    setCart(EMPTY_CART);
    setPage("shop");
  }, [setPage]);

  const loadCart = useCallback(async (activeSession = session) => {
    if (!activeSession?.token) {
      setCart(EMPTY_CART);
      return;
    }
    setLoadingCart(true);
    try {
      setCart(await apiRequest("/api/store/cart", { token: activeSession.token }));
    } catch (error) {
      if (error.status === 401) {
        handleLogout();
        setMessage({ type: "info", text: "Votre session a expiré. Reconnectez-vous pour retrouver votre panier." });
      } else setMessage({ type: "error", text: error.message });
    } finally {
      setLoadingCart(false);
    }
  }, [session, handleLogout]);

  useEffect(() => {
    loadProducts(initial.search, initial.family);
  }, [loadProducts, initial]);

  useEffect(() => {
    loadCart(session);
    // Recharger uniquement quand le client connecté change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!session?.token) { setStripeEnabled(false); setStripeConfig(null); return; }
    let active = true;
    apiRequest("/api/store/stripe/config", { token: session.token })
      .then((config) => { if (active) { setStripeEnabled(Boolean(config?.enabled)); setStripeConfig(config); } })
      .catch(() => { if (active) { setStripeEnabled(false); setStripeConfig(null); } });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order");
    const result = params.get("stripe_return");
    if (!orderId || !result || !session?.token) return;
    window.history.replaceState({}, "", `${window.location.pathname}?view=orders`);
    setPageState("orders");
    apiRequest(`/api/store/stripe/orders/${orderId}/status`, { token: session.token })
      .then(async (payment) => {
        const updatedOrders = await apiRequest("/api/store/orders", { token: session.token });
        setOrders(updatedOrders);
        setOrdersLoaded(true);
        setMessage(payment.status === "PAID"
          ? { type: "success", text: "Paiement Stripe (test) confirmé. Votre commande est transmise au magasin." }
          : { type: "info", text: payment.status === "EXPIRED" ? "Le paiement Stripe a expiré. Annulez la commande et passez-en une nouvelle." : result === "cancel" ? "Paiement annulé. Vous pouvez réessayer depuis Mes commandes." : "Le paiement est encore en attente. Vérifiez Mes commandes dans un instant." });
      })
      .catch((error) => setMessage({ type: "error", text: error.message }));
  }, [session]);

  useEffect(() => {
    if (!session?.token || page !== "orders") return;
    let active = true;
    const refreshOrders = () => apiRequest("/api/store/orders", { token: session.token })
      .then((data) => { if (active) { setOrders(data); setOrdersLoaded(true); } })
      .catch((error) => { if (active) { setOrdersLoaded(true); setMessage({ type: "error", text: error.message }); } });
    refreshOrders();
    const intervalId = window.setInterval(refreshOrders, 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [page, session]);

  function openAuth(mode = "login") {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  async function handleAuth(form) {
    setBusy(true);
    setAuthError("");
    try {
      const path = authMode === "login" ? "/api/store/auth/login" : "/api/store/auth/register";
      const nextSession = await apiRequest(path, { method: "POST", body: form });
      saveSession(nextSession);
      setSession(nextSession);
      setAuthOpen(false);
      setMessage({ type: "success", text: authMode === "login" ? "Content de vous revoir." : "Votre compte est prêt." });
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addToCart(product, quantity, { silent = false } = {}) {
    if (!session) {
      openAuth("login");
      setMessage({ type: "info", text: "Connectez-vous pour conserver votre panier d’une visite à l’autre." });
      return false;
    }
    setBusy(true);
    try {
      const nextCart = await apiRequest("/api/store/cart/items", {
        method: "POST",
        token: session.token,
        body: quantityRequest(product, quantity),
      });
      setCart(nextCart);
      if (!silent) setMessage({ type: "success", text: `${product.name || product.productName} ajouté au panier.`, action: { label: "Voir le panier", run: () => setPage("cart") } });
      return true;
    } catch (error) {
      setMessage({ type: "error", text: error.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function updateCartItem(item, value) {
    setBusy(true);
    try {
      setCart(await apiRequest(`/api/store/cart/items/${item.productId}`, {
        method: "PUT",
        token: session.token,
        body: quantityRequest(item, value),
      }));
      return true;
    } catch (error) {
      setMessage({ type: "error", text: error.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeCartItem(item) {
    setBusy(true);
    try {
      setCart(await apiRequest(`/api/store/cart/items/${item.productId}`, {
        method: "DELETE",
        token: session.token,
      }));
      setMessage({
        type: "success",
        text: `${item.productName} retiré du panier.`,
        action: { label: "Annuler", run: () => addToCart(item, quantityNumber(item.quantity), { silent: true }).then((ok) => ok && setMessage({ type: "success", text: `${item.productName} est de retour dans votre panier.` })) },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(quantities) {
    setBusy(true);
    try {
      const savedCart = await saveCartQuantities(cart, quantities, (body) =>
        apiRequest(`/api/store/cart/items/${body.productId}`, {
          method: "PUT", token: session.token, body,
        }), setCart);
      const limitMessage = paymentLimitMessage(savedCart.totalAmount, stripeConfig);
      if (limitMessage) throw new Error(limitMessage);
      const pending = await apiRequest("/api/store/checkout", { method: "POST", token: session.token });
      setCart(EMPTY_CART);
      setMessage({ type: "success", text: `Commande ${pending.orderNumber} créée, vos articles sont réservés. Payez ci-dessous pour la confirmer.` });
      setPage("orders");
      setOrders((current) => [pending, ...current.filter((order) => order.id !== pending.id)]);
      setOrdersLoaded(true);
    } catch (error) {
      // Stocks ou prix ont pu changer depuis le chargement du panier : on le recharge pour montrer pourquoi.
      await loadCart(session);
      setMessage({ type: "error", text: `${error.message} Votre panier a été actualisé avec les stocks et prix actuels.` });
    } finally {
      setBusy(false);
    }
  }

  async function simulatePayment(order) {
    setBusy(true);
    try {
      const updated = await apiRequest(`/api/store/checkout/${order.id}/confirm-payment`, {
        method: "POST",
        token: session.token,
      });
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(updated.status === "CONFIRMED"
        ? { type: "success", text: `Paiement de démonstration accepté. La commande ${updated.orderNumber} est confirmée.` }
        : { type: "error", text: `Commande ${updated.orderNumber} : ${orderStatus(updated.status).customer.toLowerCase()}. Ses articles ont été libérés.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function payWithStripe(order) {
    setBusy(true);
    try {
      const limitMessage = paymentLimitMessage(order.totalAmount, stripeConfig);
      if (limitMessage) throw new Error(limitMessage);
      const quote = await apiRequest(`/api/store/stripe/orders/${order.id}/quote`, { token: session.token });
      if (!window.confirm(`Payer ${formatMoney(order.totalAmount)}, soit ${euro(quote.amountCents)} EUR, en mode test Stripe ?\nTaux de démonstration : 1 TND = ${quote.rate} EUR.`)) return;
      const checkout = await apiRequest(`/api/store/stripe/orders/${order.id}/checkout`, {
        method: "POST", token: session.token,
      });
      window.location.assign(checkout.url);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(order) {
    if (!window.confirm(`Annuler la commande impayée ${order.orderNumber} (${formatMoney(order.totalAmount)}) ?\n\nSes articles réservés seront remis en rayon. Cette action est définitive.`)) return;
    setBusy(true);
    try {
      const updated = await apiRequest(`/api/store/orders/${order.id}/cancel`, {
        method: "POST",
        token: session.token,
      });
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({ type: "success", text: `Commande ${updated.orderNumber} : ${orderStatus(updated.status).customer.toLowerCase()}.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  const cartCount = cart.items.length;

  return (
    <div className="storefront">
      <a href="#main-content" className="skip-link">Aller au contenu</a>
      <div className="market-strip"><span>Retrait gratuit en magasin</span><span>Articles réservés dès la commande</span><span>Prix en TND</span></div>
      <Header
        session={session}
        cartCount={cartCount}
        page={page}
        onNavigate={setPage}
        onLogin={() => openAuth("login")}
        onLogout={handleLogout}
      />

      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {page === "shop" && (
          <ShopPage
            products={products}
            families={families}
            family={family}
            search={search}
            sort={sort}
            inStockOnly={inStockOnly}
            loading={loadingProducts}
            busy={busy}
            error={productError}
            onRetry={() => loadProducts(search, family)}
            onReset={() => { setSearch(""); setFamily(""); setInStockOnly(false); loadProducts(); }}
            onSearch={(event) => { event.preventDefault(); loadProducts(search, family); }}
            onSearchChange={setSearch}
            onFamilyChange={(value) => { setFamily(value); loadProducts(search, value); }}
            onSortChange={setSort}
            onInStockOnlyChange={setInStockOnly}
            onAdd={addToCart}
          />
        )}
        {page === "cart" && (
          <CartPage
            cart={cart}
            loggedIn={Boolean(session)}
            loading={loadingCart}
            busy={busy}
            onNavigate={setPage}
            stripeConfig={stripeConfig}
            onUpdate={updateCartItem}
            onRemove={removeCartItem}
            onCheckout={placeOrder}
            onLogin={() => openAuth("login")}
          />
        )}
        {page === "orders" && (
          <OrdersPage orders={orders} loaded={ordersLoaded} loggedIn={Boolean(session)} busy={busy} stripeEnabled={stripeEnabled} stripeConfig={stripeConfig} onPay={stripeEnabled ? payWithStripe : simulatePayment} onCancel={cancelOrder} onLogin={() => openAuth("login")} onShop={() => setPage("shop")} />
        )}
      </main>

      {message && <Notice key={message.text} message={message} onClose={() => setMessage(null)} />}

      <footer><span>Marché Central<small>Vos courses du quotidien.</small></span><span>Commandez en ligne, retirez en magasin.<small>Une commande impayée peut être annulée à tout moment.</small></span></footer>

      {authOpen && (
        <AuthModal
          mode={authMode}
          busy={busy}
          error={authError}
          onModeChange={setAuthMode}
          onSubmit={handleAuth}
          onClose={() => setAuthOpen(false)}
        />
      )}
    </div>
  );
}

function StoreIcon({ name, size = 20 }) {
  const paths = {
    basket: <><path d="m5 10 4-7m10 7-4-7M3 10h18l-2 11H5L3 10Z" /><path d="M9 14v3m6-3v3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    package: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10v9M3 8l9 5 9-5M7 5.8l10 5.4" /></>,
    alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4m0 3v.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Header({ session, cartCount, page, onNavigate, onLogin, onLogout }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNavigate("shop")} aria-label="Marché Central, aller à la boutique">
        <span className="brand-mark"><StoreIcon name="basket" size={24} /></span>
        <span><strong>Marché Central</strong><small>Vos courses du quotidien</small></span>
      </button>
      <nav aria-label="Navigation principale">
        <button aria-current={page === "shop" ? "page" : undefined} className={page === "shop" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("shop")}>Faire mes courses</button>
        {session && <button aria-current={page === "orders" ? "page" : undefined} className={page === "orders" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("orders")}>Mes commandes</button>}
      </nav>
      <div className="header-actions">
        {session ? <button className="account-button" onClick={onLogout}><span>{session.user?.displayName || session.user?.username}</span>Se déconnecter</button> : <button className="text-button sign-in-button" onClick={onLogin}><StoreIcon name="user" />Se connecter</button>}
        <button className="cart-button" aria-label={`Panier, ${cartCount} ${plural(cartCount, "produit", "produits")}`} aria-current={page === "cart" ? "page" : undefined} onClick={() => onNavigate("cart")}><StoreIcon name="basket" /><span>Panier</span><b className="num">{cartCount}</b></button>
      </div>
    </header>
  );
}

function ShopPage({ products, families, family, search, sort, inStockOnly, loading, busy, error, onRetry, onReset, onSearch, onSearchChange, onFamilyChange, onSortChange, onInStockOnlyChange, onAdd }) {
  const visibleProducts = useMemo(() => {
    const items = products.filter((product) => !inStockOnly || product.inStock);
    const price = (product) => Number.parseFloat(String(product.unitPrice).replace(/\s*TND$/i, ""));
    if (sort === "price-asc") items.sort((a, b) => price(a) - price(b));
    if (sort === "price-desc") items.sort((a, b) => price(b) - price(a));
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return items;
  }, [products, inStockOnly, sort]);
  const filtered = Boolean(search || family || inStockOnly);
  const familyName = families.find(([id]) => id === family)?.[1];
  return (
    <section id="catalog" className="catalog-section" aria-labelledby="catalog-title">
      <div className="catalog-head">
        <h1 id="catalog-title">{familyName || "Faites vos courses"}</h1>
        <span className="product-count num" role="status">{loading ? "Chargement des produits…" : error ? "Produits indisponibles" : productsLabel(visibleProducts.length)}</span>
      </div>
      <form className="catalog-toolbar" role="search" onSubmit={onSearch}>
        <label className="search-box"><StoreIcon name="search" /><span className="sr-only">Rechercher un produit</span><input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Que cherchez-vous ? Lait, tomates, pain…" /></label>
        <button className="button button-primary" type="submit">Rechercher</button>
      </form>
      <div className="department-list" role="group" aria-label="Rayons">
        <button className={!family ? "department active" : "department"} aria-pressed={!family} onClick={() => onFamilyChange("")}>Tous les rayons</button>
        {families.map(([id, name]) => <button key={id} className={family === id ? "department active" : "department"} aria-pressed={family === id} onClick={() => onFamilyChange(id)}>{name}</button>)}
      </div>
      <div className="catalog-options">
        <label className="stock-toggle"><input type="checkbox" checked={inStockOnly} onChange={(event) => onInStockOnlyChange(event.target.checked)} />En stock uniquement</label>
        {filtered && <button type="button" className="text-button clear-filters" onClick={onReset}>Effacer les filtres</button>}
        <span className="vat-note">Prix hors taxes (HT). La TVA est ajoutée dans le panier.</span>
        <label className="sort-control">Trier par<select value={sort} onChange={(event) => onSortChange(event.target.value)}><option value="featured">Pertinence</option><option value="price-asc">Prix croissant</option><option value="price-desc">Prix décroissant</option><option value="name">Nom (A à Z)</option></select></label>
      </div>
      {loading ? <div className="product-grid" aria-busy="true" aria-label="Chargement des produits">{Array.from({ length: 8 }, (_, index) => <div className="product-skeleton" key={index}><div /><span /><span /></div>)}</div>
        : error ? <div className="empty-state" role="alert"><StoreIcon name="basket" size={36} /><h2>Les rayons n’ont pas pu se charger</h2><p>{error}</p><button className="button button-primary" onClick={onRetry}>Réessayer</button></div>
          : visibleProducts.length === 0 ? <div className="empty-state"><StoreIcon name="search" size={36} /><h2>{filtered ? "Aucun produit trouvé" : "Les rayons se remplissent"}</h2><p>{filtered ? `Rien trouvé${search ? ` pour « ${search} »` : ""}. Vérifiez l’orthographe, essayez un mot plus court ou parcourez tous les rayons.` : "Revenez bientôt pour retrouver vos produits du quotidien."}</p>{filtered && <button className="button button-primary" onClick={onReset}>Effacer les filtres</button>}</div>
            : <div className="product-grid">{visibleProducts.map((product) => <ProductCard key={product.id} product={product} busy={busy} onAdd={onAdd} />)}</div>}
    </section>
  );
}

function StockCue({ product }) {
  const available = Number(product.availableQuantity);
  if (!product.inStock) return <span className="availability unavailable"><i />Rupture de stock</span>;
  if (Number.isFinite(available) && available > 0 && available <= (LOW_STOCK[product.unitType] ?? 0)) {
    return <span className="availability low"><i />Plus que {formatQuantity(available, product.unitType)}</span>;
  }
  return <span className="availability"><i />En stock</span>;
}

function ProductCard({ product, busy, onAdd }) {
  const weight = product.unitType === "WEIGHT";
  const [quantity, setQuantity] = useState(weight ? 0.5 : 1);
  const [imageFailed, setImageFailed] = useState(false);
  const image = assetUrl(product.imageUrl || product.familyImageUrl);
  const available = Number(product.availableQuantity);
  const max = Number.isFinite(available) && available > 0 ? String(available) : undefined;
  const vat = formatVatRate(product.vatRate);
  useEffect(() => { setImageFailed(false); }, [image]);
  return (
    <article className="product-card" aria-labelledby={`product-${product.id}`}>
      <div className="product-image">{image && !imageFailed ? <img src={image} alt="" loading="lazy" decoding="async" width="320" height="237" onError={() => setImageFailed(true)} /> : <span className="product-placeholder"><StoreIcon name="package" size={44} /><small>Pas de photo</small></span>}<StockCue product={product} /></div>
      <div className="product-body">
        <p className="product-family">{product.familyName || "Épicerie"}</p>
        <h3 id={`product-${product.id}`}>{product.name}</h3>
        <p className="product-unit">{weight ? "Vendu au kilo" : "Vendu à l’unité"}</p>
        <div className="product-buy"><strong className="num">{formatMoney(product.unitPrice)}</strong><span>/ {unitWord(product.unitType)}</span><small>HT{vat ? ` · TVA ${vat}` : ""}</small></div>
        <form className="product-actions" onSubmit={(event) => { event.preventDefault(); onAdd(product, Number(quantity)); }}>
          {product.inStock && <label className="product-quantity"><input type="number" inputMode={weight ? "decimal" : "numeric"} required min={weight ? "0.001" : "1"} max={max} step={weight ? "0.001" : "1"} value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label={`Quantité de ${product.name} en ${weight ? "kilogrammes" : "unités"}`} disabled={busy} /><span aria-hidden="true">{weight ? "kg" : "qté"}</span></label>}
          <button className="button button-primary" disabled={!product.inStock || busy}>{product.inStock && <StoreIcon name="plus" size={17} />}{product.inStock ? "Ajouter" : "Indisponible"}</button>
        </form>
      </div>
    </article>
  );
}

function stockProblem(item, draftQuantity) {
  if (item.inStock === false) return "N’est plus en stock. Retirez-le pour passer commande.";
  const available = Number(item.availableQuantity);
  if (Number.isFinite(available) && Number(draftQuantity) > available) {
    return `Seulement ${formatQuantity(available, item.unitType)} disponible${item.unitType === "WEIGHT" || available > 1 ? "s" : ""} actuellement. Baissez la quantité pour continuer.`;
  }
  return "";
}

function CartPage({ cart, loggedIn, loading, busy, stripeConfig, onNavigate, onUpdate, onRemove, onCheckout, onLogin }) {
  const [quantities, setQuantities] = useState({});
  const draftFor = (item) => quantities[item.productId] ?? String(quantityNumber(item.quantity));
  const hasDrafts = cart.items.some((item) => quantities[item.productId] !== undefined
    && Number(quantities[item.productId]) !== quantityNumber(item.quantity));
  const problems = cart.items.filter((item) => stockProblem(item, draftFor(item)));
  const limitMessage = paymentLimitMessage(cart.totalAmount, stripeConfig);
  if (!loggedIn) return <section className="simple-page narrow"><StoreIcon name="basket" size={40} /><h1>Votre panier vous attend.</h1><p>Connectez-vous pour enregistrer vos courses et les retrouver à votre prochaine visite.</p><button className="button button-primary" onClick={onLogin}>Se connecter</button></section>;
  return <section className="simple-page">
    <div className="section-heading"><div><h1>Votre panier</h1><p className="num">{productsLabel(cart.items.length)}, prêts pour votre prochaine commande.</p></div><button className="text-button" onClick={() => onNavigate("shop")}>Continuer mes courses</button></div>
    {loading && cart.items.length === 0 ? <div className="loading-state" role="status">Chargement de votre panier…</div>
      : cart.items.length === 0 ? <div className="empty-state"><StoreIcon name="basket" size={40} /><h2>Votre panier est vide.</h2><p>Parcourez les rayons et ajoutez vos produits préférés.</p><button className="button button-primary" onClick={() => onNavigate("shop")}>Faire mes courses</button></div>
        : <form className="cart-layout" onSubmit={(event) => { event.preventDefault(); onCheckout(quantities); }}>
          <div className="cart-items">{cart.items.map((item) => <CartItem key={item.productId} item={item} quantity={draftFor(item)} problem={stockProblem(item, draftFor(item))} onQuantityChange={(value) => setQuantities((current) => ({ ...current, [item.productId]: value }))} busy={busy} onUpdate={onUpdate} onRemove={onRemove} />)}</div>
          <aside className="summary-card" aria-labelledby="summary-title">
            <h2 id="summary-title">Récapitulatif</h2>
            <dl className="summary-lines">
              <div className="summary-line"><dt>Sous-total <small>HT</small></dt><dd className="num">{formatMoney(cart.subtotal)}</dd></div>
              {cart.vatAmount !== undefined && <div className="summary-line"><dt>TVA</dt><dd className="num">{formatMoney(cart.vatAmount)}</dd></div>}
              <div className="summary-line"><dt>Retrait en magasin</dt><dd>Gratuit</dd></div>
              {cart.totalAmount !== undefined && <div className="summary-line summary-total"><dt>Total <small>TTC</small></dt><dd className="num">{formatMoney(cart.totalAmount)}</dd></div>}
            </dl>
            {cart.totalAmount === undefined && <p className="summary-tax">La TVA est calculée à la création de la commande.</p>}
            {hasDrafts && <p className="summary-tax" role="status">Vos changements de quantité seront enregistrés et les totaux actualisés avant la commande.</p>}
            {problems.length > 0 && <p className="payment-limit" role="alert"><StoreIcon name="alert" size={16} />{problems.length === 1 ? "1 article demande" : `${problems.length} articles demandent`} votre attention avant de commander.</p>}
            {limitMessage && !hasDrafts && <p className="payment-limit" role="status">{limitMessage}</p>}
            <button className="button button-primary full-width" type="submit" disabled={busy || problems.length > 0 || Boolean(limitMessage && !hasDrafts)}>{busy ? "Traitement…" : "Passer la commande"}<StoreIcon name="arrow" size={18} /></button>
            <ul className="summary-notes">
              <li>Vos articles sont réservés dès la commande.</li>
              <li>Payez depuis Mes commandes avant l’échéance de réservation.</li>
              <li>Retirez votre commande en magasin avec votre code de retrait.</li>
            </ul>
          </aside>
        </form>}
  </section>;
}

function CartItem({ item, quantity, problem, onQuantityChange, busy, onUpdate, onRemove }) {
  const original = quantityNumber(item.quantity);
  const inputRef = useRef(null);
  const weight = item.unitType === "WEIGHT";
  const problemId = `cart-problem-${item.productId}`;
  function saveQuantity() {
    if (inputRef.current.reportValidity()) onUpdate(item, quantity);
  }
  return <div className={`cart-row ${problem ? "has-problem" : ""}`}>
    <div className="cart-row-art"><StoreIcon name="package" size={25} /></div>
    <div className="cart-row-copy">
      <h3>{item.productName}</h3>
      <p className="num">{formatMoney(item.unitPrice)} / {unitWord(item.unitType)} <span>HT</span></p>
      {problem && <p className="cart-problem" id={problemId}><StoreIcon name="alert" size={14} />{problem}</p>}
      <button type="button" className="remove-button" aria-label={`Retirer ${item.productName}`} onClick={() => onRemove(item)} disabled={busy}>Retirer</button>
    </div>
    <div className="cart-quantity">
      <label><input ref={inputRef} className="quantity-input" type="number" inputMode={weight ? "decimal" : "numeric"} required min={weight ? "0.001" : "1"} step={weight ? "0.001" : "1"} value={quantity} onChange={(event) => onQuantityChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveQuantity(); } }} disabled={busy} aria-label={`Quantité de ${item.productName}`} aria-describedby={problem ? problemId : undefined} aria-invalid={problem ? true : undefined} /><span aria-hidden="true">{weight ? "kg" : "qté"}</span></label>
      {Number(quantity) !== original && <button type="button" className="text-button" disabled={busy} onClick={saveQuantity}>Mettre à jour</button>}
    </div>
    <strong className="num">{formatMoney(item.lineTotal)}</strong>
  </div>;
}

function OrdersPage({ orders, loaded, loggedIn, busy, stripeEnabled, stripeConfig, onPay, onCancel, onLogin, onShop }) {
  if (!loggedIn) return <section className="simple-page narrow"><p className="eyebrow">Historique</p><h1>Vos commandes, au même endroit.</h1><p>Connectez-vous pour retrouver vos achats et leur état d’avancement.</p><button className="button button-primary" onClick={onLogin}>Se connecter</button></section>;
  return <section className="simple-page">
    <p className="eyebrow">Historique</p><h1>Vos commandes</h1>
    {!loaded ? <div className="loading-state" role="status">Chargement de vos commandes…</div>
      : orders.length === 0 ? <div className="empty-state"><StoreIcon name="package" size={36} /><h2>Aucune commande pour le moment</h2><p>Quand vous passerez commande, vous pourrez la payer et suivre sa préparation ici.</p><button className="button button-primary" onClick={onShop}>Commencer mes courses</button></div>
        : <div className="orders-list">{orders.map((order) => <OrderCard key={order.id} order={order} busy={busy} stripeEnabled={stripeEnabled} stripeConfig={stripeConfig} onPay={onPay} onCancel={onCancel} />)}</div>}
  </section>;
}

function OrderCard({ order, busy, stripeEnabled, stripeConfig, onPay, onCancel }) {
  const activeStripe = order.stripeStatus === "CREATING" || order.stripeStatus === "PENDING";
  const canPay = order.status === "PENDING_PAYMENT" && order.stripeStatus !== "EXPIRED"
    && (!activeStripe || stripeEnabled);
  const limitMessage = !activeStripe && canPay ? paymentLimitMessage(order.totalAmount, stripeConfig) : "";
  const lines = order.lines || [];
  const meta = orderStatus(order.status);
  return <article className="order-card" aria-labelledby={`order-${order.id}`}>
    <div className="order-card-head">
      <div>
        <p className="order-number" id={`order-${order.id}`}>Commande {order.orderNumber}</p>
        <p className="order-date num">Passée le {formatDateTime(order.createdAt)}</p>
      </div>
      <OrderStatusBadge status={order.status} audience="customer" />
    </div>

    <OrderProgress status={order.status} audience="customer" />
    {meta.customerHint && <p className="order-hint">{meta.customerHint}</p>}

    {order.status === "PENDING_PAYMENT" && order.expiresAt && <p className="order-deadline"><StoreIcon name="alert" size={16} /><span>À payer avant le <strong className="num">{formatDateTime(order.expiresAt)}</strong>, sinon la réservation est libérée.</span></p>}
    {activeStripe && <p className="order-hint">Le paiement Stripe est ouvert. Terminez-le avant l’expiration de la réservation.</p>}
    {order.stripeStatus === "EXPIRED" && order.status === "PENDING_PAYMENT" && <p className="order-hint">Le paiement Stripe a expiré. Annulez cette commande pour libérer ses articles.</p>}
    {order.status === "READY" && order.pickupCode && <div className="pickup-code-card"><span>Présentez ce code au comptoir du magasin pour retirer votre commande</span><strong>{order.pickupCode}</strong></div>}
    {limitMessage && <p className="payment-limit">{limitMessage} Annulez cette commande impayée et recommencez pour changer les quantités.</p>}

    <details className="order-lines">
      <summary>{lines.length} {plural(lines.length, "article", "articles")}</summary>
      <table>
        <thead><tr><th scope="col">Produit</th><th scope="col">Quantité</th><th scope="col">Total HT</th></tr></thead>
        <tbody>{lines.map((line) => <tr key={line.productId}><th scope="row">{line.productName}</th><td className="num">{formatQuantity(line.quantity, line.unitType)}</td><td className="num">{formatMoney(line.lineTotal)}</td></tr>)}</tbody>
      </table>
    </details>

    <div className="order-card-foot">
      <dl className="order-totals">
        <div><dt>TVA</dt><dd className="num">{formatMoney(order.vatAmount)}</dd></div>
        <div className="order-total"><dt>Total <small>TTC</small></dt><dd className="num">{formatMoney(order.totalAmount)}</dd></div>
      </dl>
      <div className="order-actions">
        {canPay && <button className="button button-primary" disabled={busy || Boolean(limitMessage)} onClick={() => onPay(order)}>
          {activeStripe ? "Reprendre le paiement Stripe" : stripeEnabled ? "Payer avec Stripe (test)" : "Simuler le paiement"}
        </button>}
        {order.status === "PENDING_PAYMENT" && !activeStripe && <button className="button button-quiet-danger" disabled={busy} onClick={() => onCancel(order)}>Annuler la commande</button>}
      </div>
    </div>
  </article>;
}

function AuthModal({ mode, busy, error, onModeChange, onSubmit, onClose }) {
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const dialogRef = useRef(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  const register = mode === "register";
  return <dialog className="auth-dialog" ref={dialogRef} aria-labelledby="auth-title" onCancel={onClose} onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section className="auth-modal"><button className="modal-close" onClick={onClose} aria-label="Fermer la connexion">×</button><span className="modal-brand"><StoreIcon name="basket" size={24} />Marché Central</span><h2 id="auth-title">{register ? "Bienvenue chez vous." : "Content de vous revoir."}</h2><p className="modal-intro">{register ? "Créez un compte pour enregistrer votre panier et suivre vos commandes." : "Connectez-vous pour retrouver votre panier tel que vous l’avez laissé."}</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(register ? form : { username: form.username, password: form.password }); }}>
        <label className="field"><span>E-mail ou nom d’utilisateur</span><input autoComplete="username" required minLength="3" value={form.username} disabled={busy} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        {register && <label className="field"><span>Nom affiché</span><input autoComplete="name" required value={form.displayName} disabled={busy} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>}
        <div className="field"><label htmlFor="customer-password">Mot de passe</label><span className="password-control"><input id="customer-password" autoComplete={register ? "new-password" : "current-password"} required minLength="8" type={showPassword ? "text" : "password"} value={form.password} disabled={busy} aria-describedby={register ? "password-help" : undefined} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button type="button" aria-pressed={showPassword} aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Masquer" : "Afficher"}</button></span>{register && <small id="password-help" className="field-help">Au moins 8 caractères.</small>}</div>
        <button className="button button-primary full-width" disabled={busy}>{busy ? "Veuillez patienter…" : register ? "Créer le compte" : "Se connecter"}</button>
      </form>
      <button className="switch-auth" disabled={busy} onClick={() => onModeChange(register ? "login" : "register")}>{register ? "Déjà un compte ? Se connecter" : "Nouveau ici ? Créer un compte"}</button>
    </section>
  </dialog>;
}

/** Les succès et infos disparaissent seuls ; les erreurs restent jusqu’à fermeture. */
function Notice({ message, onClose }) {
  const isError = message.type === "error";
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (isError) return undefined;
    const timeout = window.setTimeout(() => closeRef.current(), message.action ? 8000 : 5000);
    return () => window.clearTimeout(timeout);
  }, [isError, message]);
  return <div className={`notice ${message.type}`} role={isError ? "alert" : "status"}>
    <span aria-hidden="true">{isError ? "!" : "✓"}</span>
    <p>{message.text}</p>
    {message.action && <button type="button" className="notice-action" onClick={() => { const { run } = message.action; onClose(); run(); }}>{message.action.label}</button>}
    <button type="button" className="notice-close" onClick={onClose} aria-label="Fermer le message">×</button>
  </div>;
}

export default App;
