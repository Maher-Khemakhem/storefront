import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  assetUrl,
  clearSession,
  formatMoney,
  quantityNumber,
  readSession,
  saveSession,
} from "./api";

const EMPTY_CART = { items: [], subtotal: "0.000" };

function App() {
  const [session, setSession] = useState(readSession);
  const [page, setPage] = useState("shop");
  const [products, setProducts] = useState([]);
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
  const [stripeEnabled, setStripeEnabled] = useState(false);

  const loadProducts = useCallback(async (query = "", familyId = "") => {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (familyId) params.set("familyId", familyId);
      const result = await apiRequest(`/api/store/products${params.toString() ? `?${params}` : ""}`);
      setProducts(result || []);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoadingProducts(false);
    }
  }, []);

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
    if (!session?.token) { setStripeEnabled(false); return; }
    apiRequest("/api/store/stripe/config", { token: session.token })
      .then((config) => setStripeEnabled(Boolean(config?.enabled)))
      .catch(() => setStripeEnabled(false));
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
    try {
      const path = authMode === "login" ? "/api/store/auth/login" : "/api/store/auth/register";
      const nextSession = await apiRequest(path, { method: "POST", body: form });
      saveSession(nextSession);
      setSession(nextSession);
      setAuthOpen(false);
      setMessage({ type: "success", text: authMode === "login" ? "Welcome back." : "Your account is ready." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
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
        body: { productId: product.id, quantityValue: quantity, unitType: product.unitType },
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
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    setBusy(true);
    try {
      setCart(await apiRequest(`/api/store/cart/items/${item.productId}`, {
        method: "PUT",
        token: session.token,
        body: { productId: item.productId, quantityValue: quantity, unitType: item.unitType },
      }));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
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

  async function placeOrder() {
    setBusy(true);
    try {
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

  const families = useMemo(() => {
    const seen = new Map();
    products.forEach((product) => {
      if (product.familyId && !seen.has(product.familyId)) seen.set(product.familyId, product.familyName);
    });
    return [...seen.entries()];
  }, [products]);

  return (
    <div className="storefront">
      <Header
        session={session}
        cartCount={cart.items.length}
        page={page}
        onNavigate={setPage}
        onLogin={() => { setAuthMode("login"); setAuthOpen(true); }}
        onLogout={handleLogout}
      />

      <main>
        {message && <Notice message={message} onClose={() => setMessage(null)} />}
        {page === "shop" && (
          <ShopPage
            products={products}
            families={families}
            family={family}
            search={search}
            loading={loadingProducts}
            busy={busy}
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
            onUpdate={updateCartItem}
            onRemove={removeCartItem}
            onCheckout={placeOrder}
            onLogin={() => { setAuthMode("login"); setAuthOpen(true); }}
          />
        )}
        {page === "orders" && (
          <OrdersPage orders={orders} loggedIn={Boolean(session)} busy={busy} stripeEnabled={stripeEnabled} onPay={stripeEnabled ? payWithStripe : simulatePayment} onCancel={cancelOrder} onLogin={() => { setAuthMode("login"); setAuthOpen(true); }} />
        )}
      </main>

      <footer><span>Marché Central</span><span>Fresh groceries, ready when you are.</span></footer>

      {authOpen && (
        <AuthModal
          mode={authMode}
          busy={busy}
          onModeChange={setAuthMode}
          onSubmit={handleAuth}
          onClose={() => setAuthOpen(false)}
        />
      )}
    </div>
  );
}

function Header({ session, cartCount, page, onNavigate, onLogin, onLogout }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNavigate("shop")} aria-label="Go to shop">
        <span className="brand-mark">MC</span>
        <span><strong>Marché Central</strong><small>Everyday provisions</small></span>
      </button>
      <nav>
        <button className={page === "shop" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("shop")}>Shop</button>
        {session && <button className={page === "orders" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("orders")}>My orders</button>}
      </nav>
      <div className="header-actions">
        {session ? <button className="account-button" onClick={onLogout}>Sign out <span>{session.user?.displayName || session.user?.username}</span></button> : <button className="text-button" onClick={onLogin}>Sign in</button>}
        <button className="cart-button" onClick={() => onNavigate("cart")}><span>Basket</span><b>{cartCount}</b></button>
      </div>
    </header>
  );
}

function ShopPage({ products, families, family, search, loading, busy, onSearch, onSearchChange, onFamilyChange, onAdd }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Good food, simply chosen</p>
          <h1>The market,<br /><em>at your door.</em></h1>
          <p className="hero-description">A considered collection of everyday groceries from your local supermarket. Browse what is fresh today and we’ll take care of the rest.</p>
          <a className="hero-link" href="#catalog">Browse the collection <span>↓</span></a>
        </div>
        <div className="hero-art" aria-hidden="true"><span className="art-leaf leaf-one">✦</span><span className="art-leaf leaf-two">◒</span><span className="art-basket">✿</span><span className="art-caption">LOCAL<br />&amp; FRESH</span></div>
      </section>
      <section id="catalog" className="catalog-section">
        <div className="section-heading"><div><p className="eyebrow">The collection</p><h2>Choose your essentials</h2></div><span className="product-count">{products.length} products</span></div>
        <form className="catalog-toolbar" onSubmit={onSearch}>
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search products" aria-label="Search products" /></label>
          <select value={family} onChange={(event) => onFamilyChange(event.target.value)} aria-label="Filter by family"><option value="">All departments</option>{families.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <button className="button button-dark" type="submit">Search</button>
        </form>
        {loading ? <div className="loading-state">Gathering today’s products…</div> : products.length === 0 ? <div className="empty-state"><span>⌕</span><h3>Nothing found</h3><p>Try another search or browse all departments.</p></div> : <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} busy={busy} onAdd={onAdd} />)}</div>}
      </section>
    </>
  );
}

function ProductCard({ product, busy, onAdd }) {
  const [quantity, setQuantity] = useState(product.unitType === "WEIGHT" ? 0.5 : 1);
  const image = assetUrl(product.imageUrl || product.familyImageUrl);
  return (
    <article className="product-card">
      <div className="product-image">{image ? <img src={image} alt="" /> : <span className="product-placeholder">✦</span>}<span className={product.inStock ? "availability" : "availability unavailable"}>{product.inStock ? "In stock" : "Out of stock"}</span></div>
      <div className="product-body"><p className="product-family">{product.familyName || "Grocery"}</p><h3>{product.name}</h3><p className="product-unit">{product.unitType === "WEIGHT" ? "Sold by kilogram" : "Sold per unit"}</p><div className="product-buy"><strong>{formatMoney(product.unitPrice)}</strong><span>/{product.unitType === "WEIGHT" ? "kg" : "unit"}</span></div><div className="product-actions">{product.inStock && <input type="number" min={product.unitType === "WEIGHT" ? "0.001" : "1"} step={product.unitType === "WEIGHT" ? "0.1" : "1"} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} aria-label={`Quantity of ${product.name}`} />}<button className="button button-primary" disabled={!product.inStock || busy} onClick={() => onAdd(product, quantity)}>{product.inStock ? "Add to basket" : "Unavailable"}</button></div></div>
    </article>
  );
}

function CartPage({ cart, loggedIn, loading, busy, onNavigate, onUpdate, onRemove, onCheckout, onLogin }) {
  if (!loggedIn) return <section className="simple-page narrow"><p className="eyebrow">Your basket</p><h1>Sign in to see your basket.</h1><p>Your basket is securely tied to your customer account.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></section>;
  return <section className="simple-page"><div className="section-heading"><div><p className="eyebrow">Your basket</p><h1>Ready when you are.</h1></div><button className="text-button" onClick={() => onNavigate("shop")}>← Continue shopping</button></div>{loading ? <div className="loading-state">Loading your basket…</div> : cart.items.length === 0 ? <div className="empty-state"><span>✦</span><h3>Your basket is empty</h3><p>Start with something good from the collection.</p><button className="button button-primary" onClick={() => onNavigate("shop")}>Browse products</button></div> : <div className="cart-layout"><div className="cart-items">{cart.items.map((item) => <div className="cart-row" key={item.productId}><div className="cart-row-art">✦</div><div className="cart-row-copy"><h3>{item.productName}</h3><p>{formatMoney(item.unitPrice)} / {item.unitType === "WEIGHT" ? "kg" : "unit"}</p></div><input className="quantity-input" type="number" min="0.001" step={item.unitType === "WEIGHT" ? "0.1" : "1"} value={quantityNumber(item.quantity)} onChange={(event) => onUpdate(item, event.target.value)} disabled={busy} /><strong>{formatMoney(item.lineTotal)}</strong><button className="remove-button" onClick={() => onRemove(item)} disabled={busy}>Remove</button></div>)}</div><aside className="summary-card"><p className="eyebrow">Order summary</p><div className="summary-line"><span>Subtotal</span><strong>{formatMoney(cart.subtotal)}</strong></div><div className="summary-line muted"><span>VAT calculated at checkout</span></div><button className="button button-primary full-width" onClick={onCheckout} disabled={busy}>{busy ? "Processing…" : "Place order"}</button><small>Placing an order reserves stock. Complete payment from My orders.</small></aside></div>}</section>;
}

function OrdersPage({ orders, loggedIn, busy, stripeEnabled, onPay, onCancel, onLogin }) {
  if (!loggedIn) return <section className="simple-page narrow"><p className="eyebrow">Order history</p><h1>Your orders, all in one place.</h1><p>Sign in to see previous purchases and their current status.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></section>;
  return <section className="simple-page">
    <p className="eyebrow">Order history</p><h1>Your orders</h1>
    {orders.length === 0 ? <div className="empty-state"><span>○</span><h3>No orders yet</h3><p>Your orders will appear here.</p></div> :
      <div className="orders-list">{orders.map((order) => {
        const activeStripe = order.stripeStatus === "CREATING" || order.stripeStatus === "PENDING";
        const canPay = order.status === "PENDING_PAYMENT" && order.stripeStatus !== "EXPIRED"
          && (!activeStripe || stripeEnabled);
        return <article className="order-card" key={order.id}>
          <div><p className="order-number">{order.orderNumber}</p><h3>{new Date(order.createdAt).toLocaleDateString()}</h3>
            <p>{order.lines?.length || 0} item{order.lines?.length === 1 ? "" : "s"}</p>
            {order.status === "PENDING_PAYMENT" && order.expiresAt && <p>Payment due by {new Date(order.expiresAt).toLocaleString()}</p>}
            {activeStripe && <p>Stripe checkout is active. Complete payment before the reservation expires.</p>}
            {order.stripeStatus === "EXPIRED" && order.status === "PENDING_PAYMENT" && <p>Stripe checkout expired. Cancel this order to release its stock.</p>}
            {order.status === "READY" && order.pickupCode && <div className="pickup-code-card"><span>Show this code to staff when you collect your order</span><strong>{order.pickupCode}</strong></div>}
          </div>
          <div className="order-card-right"><span className={'status status-' + order.status.toLowerCase()}>{order.status.replaceAll("_", " ")}</span>
            <strong>{formatMoney(order.totalAmount)}</strong>
            {canPay && <button className="button button-primary" disabled={busy} onClick={() => onPay(order)}>
              {activeStripe ? "Resume Stripe checkout" : stripeEnabled ? "Pay with Stripe test" : "Simulate payment"}
            </button>}
            {order.status === "PENDING_PAYMENT" && !activeStripe && <button className="cancel-order-button" disabled={busy} onClick={() => onCancel(order)}>Cancel order</button>}
          </div>
        </article>;
      })}</div>}
  </section>;
}
function AuthModal({ mode, busy, onModeChange, onSubmit, onClose }) {
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const register = mode === "register";
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="auth-modal"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><p className="eyebrow">Marché Central</p><h2>{register ? "Create your account" : "Welcome back"}</h2><p className="modal-intro">{register ? "Save your basket and follow every order." : "Sign in to continue shopping."}</p><form onSubmit={(event) => { event.preventDefault(); onSubmit(register ? form : { username: form.username, password: form.password }); }}><label className="field"><span>Email or username</span><input required minLength="3" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>{register && <label className="field"><span>Display name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>}<label className="field"><span>Password</span><input required minLength="8" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><button className="button button-primary full-width" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button></form><button className="switch-auth" onClick={() => onModeChange(register ? "login" : "register")}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</button></section></div>;
}

function Notice({ message, onClose }) {
  return <div className={`notice ${message.type}`} role="status"><span>{message.type === "error" ? "!" : "✓"}</span><p>{message.text}</p><button onClick={onClose} aria-label="Dismiss">×</button></div>;
}

export default App;
