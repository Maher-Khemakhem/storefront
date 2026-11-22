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

const EMPTY_CART = { items: [], subtotal: "0.000" };

function App() {
  const [session, setSession] = useState(readSession);
  const [page, setPage] = useState("shop");
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [productError, setProductError] = useState("");
  const productRequest = useRef(0);
  const mainRef = useRef(null);
  const previousPage = useRef(page);
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState("");
  const [cart, setCart] = useState(EMPTY_CART);
  const [orders, setOrders] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingCart, setLoadingCart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeConfig, setStripeConfig] = useState(null);

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

  useEffect(() => {
    document.title = `${page === "cart" ? "Your basket" : page === "orders" ? "Your orders" : "Shop groceries"} | Marché Central`;
    if (previousPage.current !== page) {
      window.scrollTo({ top: 0, behavior: "instant" });
      mainRef.current?.focus({ preventScroll: true });
      previousPage.current = page;
    }
  }, [page]);

  useEffect(() => { setAuthError(""); }, [authOpen, authMode]);

  const loadCart = useCallback(async (activeSession = session) => {
    if (!activeSession?.token) {
      setCart(EMPTY_CART);
      return;
    }
    setLoadingCart(true);
    try {
      setCart(await apiRequest("/api/store/cart", { token: activeSession.token }));
    } catch (error) {
      if (error.message.toLowerCase().includes("401")) handleLogout();
      else setMessage({ type: "error", text: error.message });
    } finally {
      setLoadingCart(false);
    }
  }, [session]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadCart(session);
  }, [session, loadCart]);

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
    window.history.replaceState({}, "", window.location.pathname);
    setPage("orders");
    apiRequest(`/api/store/stripe/orders/${orderId}/status`, { token: session.token })
      .then(async (payment) => {
        const updatedOrders = await apiRequest("/api/store/orders", { token: session.token });
        setOrders(updatedOrders);
        setMessage(payment.status === "PAID"
          ? { type: "success", text: "Stripe test payment confirmed. Your order is ready for the store." }
          : { type: "info", text: payment.status === "EXPIRED" ? "Stripe Checkout expired. Cancel the order and place a new one." : result === "cancel" ? "Checkout was cancelled. You can try again from My orders." : "Payment is still pending. Check My orders shortly." });
      })
      .catch((error) => setMessage({ type: "error", text: error.message }));
  }, [session]);

  useEffect(() => {
    if (!session?.token || page !== "orders") return;
    let active = true;
    const refreshOrders = () => apiRequest("/api/store/orders", { token: session.token })
      .then((data) => { if (active) setOrders(data); })
      .catch((error) => { if (active) setMessage({ type: "error", text: error.message }); });
    refreshOrders();
    const intervalId = window.setInterval(refreshOrders, 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [page, session]);

  function handleLogout() {
    clearSession();
    setSession(null);
    setOrders([]);
    setCart(EMPTY_CART);
    setPage("shop");
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
      setMessage({ type: "success", text: authMode === "login" ? "Welcome back." : "Your account is ready." });
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addToCart(product, quantity) {
    if (!session) {
      setAuthMode("login");
      setAuthOpen(true);
      setMessage({ type: "info", text: "Sign in to keep your cart between visits." });
      return;
    }
    setBusy(true);
    try {
      const nextCart = await apiRequest("/api/store/cart/items", {
        method: "POST",
        token: session.token,
        body: quantityRequest(product, quantity),
      });
      setCart(nextCart);
      setMessage({ type: "success", text: `${product.name} added to your basket.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
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
      setMessage({ type: "success", text: `Order ${pending.orderNumber} created. Pay from My orders when you're ready.` });
      setPage("orders");
      setOrders((current) => [pending, ...current.filter((order) => order.id !== pending.id)]);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
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
        ? { type: "success", text: `Demo payment accepted. Order ${updated.orderNumber} is confirmed.` }
        : { type: "error", text: `Order ${updated.orderNumber} is ${updated.status.toLowerCase()}; its reserved stock has been released.` });
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
      if (!window.confirm(`Pay ${formatMoney(order.totalAmount)} as ${(quote.amountCents / 100).toFixed(2)} EUR in Stripe test mode? Demo rate: 1 TND = ${quote.rate} EUR.`)) return;
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
    if (!window.confirm(`Cancel unpaid order ${order.orderNumber}? Its reserved stock will be released.`)) return;
    setBusy(true);
    try {
      const updated = await apiRequest(`/api/store/orders/${order.id}/cancel`, {
        method: "POST",
        token: session.token,
      });
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({ type: "success", text: `Order ${updated.orderNumber} is ${updated.status.toLowerCase()}.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="storefront">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="market-strip"><span>Marché Central</span><span>Your everyday grocery shop</span><span>Prices in TND</span></div>
      <Header
        session={session}
        cartCount={cart.items.length}
        page={page}
        onNavigate={setPage}
        onLogin={() => { setAuthMode("login"); setAuthOpen(true); }}
        onLogout={handleLogout}
      />

      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {message && <Notice message={message} onClose={() => setMessage(null)} />}
        {page === "shop" && (
          <ShopPage
            products={products}
            families={families}
            family={family}
            search={search}
            loading={loadingProducts}
            busy={busy}
            error={productError}
            onRetry={() => loadProducts(search, family)}
            onReset={() => { setSearch(""); setFamily(""); loadProducts(); }}
            onSearch={(event) => { event.preventDefault(); loadProducts(search, family); }}
            onSearchChange={setSearch}
            onFamilyChange={(value) => { setFamily(value); loadProducts(search, value); }}
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
            onLogin={() => { setAuthMode("login"); setAuthOpen(true); }}
          />
        )}
        {page === "orders" && (
          <OrdersPage orders={orders} loggedIn={Boolean(session)} busy={busy} stripeEnabled={stripeEnabled} stripeConfig={stripeConfig} onPay={stripeEnabled ? payWithStripe : simulatePayment} onCancel={cancelOrder} onLogin={() => { setAuthMode("login"); setAuthOpen(true); }} />
        )}
      </main>

      <footer><span>Marché Central<small>Everyday provisions.</small></span><span>Shop. Pay. Follow your order.<small>Your next grocery run starts here.</small></span></footer>

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
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function MarketIllustration() {
  return <div className="hero-art" aria-hidden="true">
    <svg viewBox="0 0 460 340" fill="none">
      <ellipse cx="239" cy="303" rx="171" ry="17" fill="#A9CEB4" />
      <path d="M279 147c-8-40 7-89 43-112 13 49-4 99-29 121" fill="#317B50" />
      <path d="M290 154c19-44 55-65 92-60-9 43-44 68-85 75" fill="#77A46A" />
      <path d="M279 160c-47-26-60-61-54-98 41 15 66 49 65 93" fill="#195B3F" />
      <path d="m289 199 8-92" stroke="#C0D28C" strokeWidth="5" strokeLinecap="round" />
      <rect x="140" y="40" width="47" height="211" rx="23.5" transform="rotate(-20 140 40)" fill="#DDA16A" />
      <path d="m165 80 20 7m-8 29 20 7m-8 29 20 7" stroke="#F3D6AA" strokeWidth="8" strokeLinecap="round" />
      <path d="M99 171c-17-28-10-58 16-68 26-9 54 11 56 43 3 37-13 58-34 58-17 0-30-12-38-33Z" fill="#E8C747" />
      <path d="M137 107c-5-21 2-37 15-45 9 21 4 40-15 45Z" fill="#337E52" />
      <circle cx="248" cy="166" r="45" fill="#E8755B" />
      <path d="m249 123 5 20 18-7-14 16 12 12-24-6-13 9 4-19-14-13 21 5 5-17Z" fill="#285E3B" />
      <path d="M79 185h302l-34 104a18 18 0 0 1-17 12H132a18 18 0 0 1-17-12L79 185Z" fill="#246646" />
      <path d="m117 207 22 72m27-72 11 72m48-72v72m46-72-11 72m48-72-22 72m-173-36h231" stroke="#85B99B" strokeWidth="6" strokeLinecap="round" />
      <path d="m140 188 39-73m141 73-40-73" stroke="#174A34" strokeWidth="11" strokeLinecap="round" />
      <rect x="71" y="179" width="319" height="17" rx="8.5" fill="#174A34" />
      <path d="m378 38 3 12 12 3-12 3-3 12-3-12-12-3 12-3 3-12Z" fill="#317B50" />
      <circle cx="95" cy="54" r="5" fill="#78A66B" />
    </svg>
  </div>;
}

function Header({ session, cartCount, page, onNavigate, onLogin, onLogout }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNavigate("shop")} aria-label="Go to shop">
        <span className="brand-mark"><StoreIcon name="basket" size={26} /></span>
        <span><strong>Marché Central</strong><small>Everyday provisions</small></span>
      </button>
      <nav aria-label="Main navigation">
        <button aria-current={page === "shop" ? "page" : undefined} className={page === "shop" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("shop")}>Shop groceries</button>
        {session && <button aria-current={page === "orders" ? "page" : undefined} className={page === "orders" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("orders")}>My orders</button>}
      </nav>
      <div className="header-actions">
        {session ? <button className="account-button" onClick={onLogout}><span>{session.user?.displayName || session.user?.username}</span>Sign out</button> : <button className="text-button sign-in-button" onClick={onLogin}><StoreIcon name="user" />Sign in</button>}
        <button className="cart-button" aria-label={`Basket, ${cartCount} ${cartCount === 1 ? "product" : "products"}`} aria-current={page === "cart" ? "page" : undefined} onClick={() => onNavigate("cart")}><StoreIcon name="basket" /><span>Basket</span><b>{cartCount}</b></button>
      </div>
    </header>
  );
}

function ShopPage({ products, families, family, search, loading, busy, error, onRetry, onReset, onSearch, onSearchChange, onFamilyChange, onAdd }) {
  const [sort, setSort] = useState("featured");
  const [inStockOnly, setInStockOnly] = useState(false);
  const visibleProducts = useMemo(() => {
    const items = products.filter((product) => !inStockOnly || product.inStock);
    const price = (product) => Number.parseFloat(String(product.unitPrice).replace(/\s*TND$/i, ""));
    if (sort === "price-asc") items.sort((a, b) => price(a) - price(b));
    if (sort === "price-desc") items.sort((a, b) => price(b) - price(a));
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [products, inStockOnly, sort]);
  const filtered = Boolean(search || family || inStockOnly);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Good things<br />for your basket.</h1>
          <p className="hero-description">From the first coffee to tonight’s dinner. Find your everyday groceries, all in one place.</p>
          <a className="hero-link" href="#catalog">Shop the aisles <StoreIcon name="arrow" /></a>
        </div>
        <MarketIllustration />
      </section>
      <section id="catalog" className="catalog-section">
        <div className="section-heading"><div><h2>Your everyday essentials</h2><p>Find a favourite. Try something new.</p></div><span className="product-count" role="status">{loading ? "Loading products…" : error ? "Products unavailable" : `${visibleProducts.length} ${visibleProducts.length === 1 ? "product" : "products"}`}</span></div>
        <form className="catalog-toolbar" onSubmit={onSearch}>
          <label className="search-box"><StoreIcon name="search" /><input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="What’s on your shopping list?" aria-label="Search products" /></label>
          <button className="button button-dark" type="submit">Search</button>
        </form>
        <div className="department-list" role="group" aria-label="Shop by department">
          <button className={!family ? "department active" : "department"} aria-pressed={!family} onClick={() => onFamilyChange("")}>All departments</button>
          {families.map(([id, name]) => <button key={id} className={family === id ? "department active" : "department"} aria-pressed={family === id} onClick={() => onFamilyChange(id)}>{name}</button>)}
        </div>
        <div className="catalog-options"><label className="stock-toggle"><input type="checkbox" checked={inStockOnly} onChange={(event) => setInStockOnly(event.target.checked)} />In stock only</label><label className="sort-control">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name: A to Z</option></select></label></div>
        {loading ? <div className="product-grid" aria-busy="true" aria-label="Loading products">{Array.from({ length: 4 }, (_, index) => <div className="product-skeleton" key={index}><div /><span /><span /></div>)}</div> : error ? <div className="empty-state" role="alert"><StoreIcon name="basket" size={36} /><h3>The shelves couldn’t load</h3><p>{error}</p><button className="button button-primary" onClick={onRetry}>Try again</button></div> : visibleProducts.length === 0 ? <div className="empty-state"><StoreIcon name="search" size={36} /><h3>{filtered ? "No products match" : "The shelves are being stocked"}</h3><p>{filtered ? "Try a different search or browse all departments." : "Check back soon for your everyday groceries."}</p>{filtered && <button className="button button-primary" onClick={() => { setInStockOnly(false); onReset(); }}>Clear filters</button>}</div> : <div className="product-grid">{visibleProducts.map((product) => <ProductCard key={product.id} product={product} busy={busy} onAdd={onAdd} />)}</div>}
      </section>
    </>
  );
}

function ProductCard({ product, busy, onAdd }) {
  const [quantity, setQuantity] = useState(product.unitType === "WEIGHT" ? 0.5 : 1);
  const [imageFailed, setImageFailed] = useState(false);
  const image = assetUrl(product.imageUrl || product.familyImageUrl);
  const weight = product.unitType === "WEIGHT";
  useEffect(() => { setImageFailed(false); }, [image]);
  return (
    <article className="product-card">
      <div className="product-image">{image && !imageFailed ? <img src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <span className="product-placeholder"><StoreIcon name="package" size={48} /><small>{product.familyName || "Everyday essentials"}</small></span>}<span className={product.inStock ? "availability" : "availability unavailable"}><i />{product.inStock ? "In stock" : "Out of stock"}</span></div>
      <div className="product-body"><p className="product-family">{product.familyName || "Grocery"}</p><h3>{product.name}</h3><p className="product-unit">{weight ? "Sold by kilogram" : "Sold per unit"}</p><div className="product-buy"><strong>{formatMoney(product.unitPrice)}</strong><span>/{weight ? "kg" : "unit"}</span></div><form className="product-actions" onSubmit={(event) => { event.preventDefault(); onAdd(product, Number(quantity)); }}>{product.inStock && <label className="product-quantity"><input type="number" required min={weight ? "0.001" : "1"} step={weight ? "0.001" : "1"} value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label={`Quantity of ${product.name}`} disabled={busy} /><span>{weight ? "kg" : "qty"}</span></label>}<button className="button button-primary" disabled={!product.inStock || busy}>{product.inStock && <StoreIcon name="plus" size={17} />}{product.inStock ? "Add to basket" : "Unavailable"}</button></form></div>
    </article>
  );
}

function CartPage({ cart, loggedIn, loading, busy, stripeConfig, onNavigate, onUpdate, onRemove, onCheckout, onLogin }) {
  const [quantities, setQuantities] = useState({});
  const hasDrafts = cart.items.some((item) => quantities[item.productId] !== undefined
    && Number(quantities[item.productId]) !== quantityNumber(item.quantity));
  const limitMessage = paymentLimitMessage(cart.totalAmount, stripeConfig);
  if (!loggedIn) return <section className="simple-page narrow"><StoreIcon name="basket" size={40} /><h1>Your basket is waiting.</h1><p>Sign in to save your groceries and pick up where you left off.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></section>;
  return <section className="simple-page">
    <div className="section-heading"><div><h1>Your basket</h1><p>{cart.items.length} {cart.items.length === 1 ? "product" : "products"}, ready for your next order.</p></div><button className="text-button" onClick={() => onNavigate("shop")}>Continue shopping</button></div>
    {loading ? <div className="loading-state" role="status">Loading your basket…</div> : cart.items.length === 0 ? <div className="empty-state"><StoreIcon name="basket" size={40} /><h3>Good things start with an empty basket.</h3><p>Explore the aisles and add your everyday favourites.</p><button className="button button-primary" onClick={() => onNavigate("shop")}>Shop groceries</button></div> : <form className="cart-layout" onSubmit={(event) => { event.preventDefault(); onCheckout(quantities); }}>
      <div className="cart-items">{cart.items.map((item) => <CartItem key={item.productId} item={item} quantity={quantities[item.productId] ?? String(quantityNumber(item.quantity))} onQuantityChange={(value) => setQuantities((current) => ({ ...current, [item.productId]: value }))} busy={busy} onUpdate={onUpdate} onRemove={onRemove} />)}</div>
      <aside className="summary-card">
        <h2>Order summary</h2>
        <div className="summary-line"><span>Subtotal</span><strong>{formatMoney(cart.subtotal)}</strong></div>
        {cart.vatAmount !== undefined && <div className="summary-line"><span>VAT</span><strong>{formatMoney(cart.vatAmount)}</strong></div>}
        {cart.totalAmount !== undefined ? <div className="summary-line"><span>Total</span><strong>{formatMoney(cart.totalAmount)}</strong></div> : <p className="summary-tax">VAT is calculated at checkout.</p>}
        {hasDrafts && <p className="summary-tax" role="status">Your quantity changes will be saved and totals refreshed before the order is placed.</p>}
        {limitMessage && !hasDrafts && <p className="payment-limit" role="status">{limitMessage}</p>}
        <button className="button button-primary full-width" type="submit" disabled={busy || Boolean(limitMessage && !hasDrafts)}>{busy ? "Processing…" : "Place order"}<StoreIcon name="arrow" size={18} /></button>
        <small>We’ll reserve your items when you place the order. Complete payment from My orders.</small>
      </aside>
    </form>}
  </section>;
}

function CartItem({ item, quantity, onQuantityChange, busy, onUpdate, onRemove }) {
  const original = quantityNumber(item.quantity);
  const inputRef = useRef(null);
  const weight = item.unitType === "WEIGHT";
  function saveQuantity() {
    if (inputRef.current.reportValidity()) onUpdate(item, quantity);
  }
  return <div className="cart-row">
    <div className="cart-row-art"><StoreIcon name="package" size={25} /></div>
    <div className="cart-row-copy"><h3>{item.productName}</h3><p>{formatMoney(item.unitPrice)} / {weight ? "kg" : "unit"}</p><button type="button" className="remove-button" aria-label={`Remove ${item.productName}`} onClick={() => onRemove(item)} disabled={busy}>Remove</button></div>
    <div className="cart-quantity">
      <label><input ref={inputRef} className="quantity-input" type="number" required min={weight ? "0.001" : "1"} step={weight ? "0.001" : "1"} value={quantity} onChange={(event) => onQuantityChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveQuantity(); } }} disabled={busy} aria-label={`Quantity of ${item.productName}`} /><span>{weight ? "kg" : "qty"}</span></label>
      {Number(quantity) !== original && <button type="button" className="text-button" disabled={busy} onClick={saveQuantity}>Update</button>}
    </div>
    <strong>{formatMoney(item.lineTotal)}</strong>
  </div>;
}

function OrdersPage({ orders, loggedIn, busy, stripeEnabled, stripeConfig, onPay, onCancel, onLogin }) {
  if (!loggedIn) return <section className="simple-page narrow"><p className="eyebrow">Order history</p><h1>Your orders, all in one place.</h1><p>Sign in to see previous purchases and their current status.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></section>;
  return <section className="simple-page">
    <p className="eyebrow">Order history</p><h1>Your orders</h1>
    {orders.length === 0 ? <div className="empty-state"><span>○</span><h3>No orders yet</h3><p>Your orders will appear here.</p></div> :
      <div className="orders-list">{orders.map((order) => {
        const activeStripe = order.stripeStatus === "CREATING" || order.stripeStatus === "PENDING";
        const canPay = order.status === "PENDING_PAYMENT" && order.stripeStatus !== "EXPIRED"
          && (!activeStripe || stripeEnabled);
        const limitMessage = !activeStripe && canPay ? paymentLimitMessage(order.totalAmount, stripeConfig) : "";
        return <article className="order-card" key={order.id}>
          <div><p className="order-number">{order.orderNumber}</p><h3>{new Date(order.createdAt).toLocaleDateString()}</h3>
            <p>{order.lines?.length || 0} item{order.lines?.length === 1 ? "" : "s"}</p>
            {order.status === "PENDING_PAYMENT" && order.expiresAt && <p>Payment due by {new Date(order.expiresAt).toLocaleString()}</p>}
            {activeStripe && <p>Stripe checkout is active. Complete payment before the reservation expires.</p>}
            {order.stripeStatus === "EXPIRED" && order.status === "PENDING_PAYMENT" && <p>Stripe checkout expired. Cancel this order to release its stock.</p>}
            {order.status === "READY" && order.pickupCode && <div className="pickup-code-card"><span>Show this code to staff when you collect your order</span><strong>{order.pickupCode}</strong></div>}
            {limitMessage && <p className="payment-limit">{limitMessage} Cancel this unpaid order and shop again to change its quantities.</p>}
          </div>
          <div className="order-card-right"><span className={'status status-' + order.status.toLowerCase()}>{order.status.replaceAll("_", " ")}</span>
            <strong>{formatMoney(order.totalAmount)}</strong>
            {canPay && <button className="button button-primary" disabled={busy || Boolean(limitMessage)} onClick={() => onPay(order)}>
              {activeStripe ? "Resume Stripe checkout" : stripeEnabled ? "Pay with Stripe test" : "Simulate payment"}
            </button>}
            {order.status === "PENDING_PAYMENT" && !activeStripe && <button className="cancel-order-button" disabled={busy} onClick={() => onCancel(order)}>Cancel order</button>}
          </div>
        </article>;
      })}</div>}
  </section>;
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
    <section className="auth-modal"><button className="modal-close" onClick={onClose} aria-label="Close sign in">×</button><span className="modal-brand"><StoreIcon name="basket" size={24} />Marché Central</span><h2 id="auth-title">{register ? "Make yourself at home." : "Welcome back."}</h2><p className="modal-intro">{register ? "Create an account to save your basket and follow your orders." : "Sign in to find your basket, just as you left it."}</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(register ? form : { username: form.username, password: form.password }); }}>
        <label className="field"><span>Email or username</span><input autoComplete="username" required minLength="3" value={form.username} disabled={busy} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        {register && <label className="field"><span>Display name</span><input autoComplete="name" required value={form.displayName} disabled={busy} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>}
        <div className="field"><label htmlFor="customer-password">Password</label><span className="password-control"><input id="customer-password" autoComplete={register ? "new-password" : "current-password"} required minLength="8" type={showPassword ? "text" : "password"} value={form.password} disabled={busy} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button type="button" aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Show"}</button></span></div>
        <button className="button button-primary full-width" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
      </form>
      <button className="switch-auth" disabled={busy} onClick={() => onModeChange(register ? "login" : "register")}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</button>
    </section>
  </dialog>;
}

function Notice({ message, onClose }) {
  return <div className={`notice ${message.type}`} role="status"><span>{message.type === "error" ? "!" : "✓"}</span><p>{message.text}</p><button onClick={onClose} aria-label="Dismiss">×</button></div>;
}

export default App;
