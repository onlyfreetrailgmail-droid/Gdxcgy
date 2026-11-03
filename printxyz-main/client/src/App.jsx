import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSeo, productLd, breadcrumbLd, organizationLd, websiteLd, isPrivatePath } from './seo';
import { initTracking, pageView, trackViewContent, trackAddToCart, trackInitiateCheckout, trackPurchase, getAttributionForOrder, hasMarketingConsent } from './tracking';
import CookieBanner, { openCookieSettings } from './CookieBanner';
import AccountPanel from './AccountPanel';
import PincodeCheck from './PincodeCheck';
import CancelOrder from './CancelOrder';
import { CustomOptions, isCustomProduct, needsPhoto, toCartOptions } from './CustomOptions';
import { PaymentPlan, ReturnRequest } from './OrderExtras';
import MaterialGuidePage from './MaterialGuide';
import { INDIAN_STATES } from './states';
import AddressPicker from './AddressPicker';
import AdminCancellations from './AdminCancellations';
import AdminTools from './AdminTools';
import ContactForm from './ContactForm';
import { ProductReviews, RecentReviews } from './Reviews';
import { WishlistButton, loadWishlistProducts } from './Wishlist';
import { AboutPage, FaqPage, SizeGuidePage, CarePage } from './brandPages';
import { banners, blogPosts, categories, galleryItems, products } from './data';

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

const formatMoney = (value) => money.format(value || 0);

const getVisibleProducts = (list, filter = '', sort = 'featured') => {
  const q = filter.toLowerCase();
  let next = q
    ? list.filter((product) => {
        return [product.title, product.category, ...(product.tags || [])].join(' ').toLowerCase().includes(q);
      })
    : [...list];

  if (sort === 'price-low') next.sort((a, b) => a.price - b.price);
  if (sort === 'price-high') next.sort((a, b) => b.price - a.price);
  if (sort === 'rating') next.sort((a, b) => b.rating - a.rating);
  if (sort === 'newest') next.sort((a, b) => (b.id > a.id ? 1 : -1));

  return next;
};

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';


const syncProductsFromApi = async () => {
  try {
    const response = await fetch('/api/products');
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.items) || !data.items.length) return;

    products.splice(0, products.length, ...data.items.map((item) => normalizeProduct(item, item.id || 'server-product')));
    return products;
  } catch {
    return null;
  }
};

const normalizeProduct = (product, fallbackId = 'prod') => ({
  id: String(product.id || `${fallbackId}-${Date.now()}`),
  slug: String(product.slug || product.title || 'custom-product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  title: String(product.title || 'Custom Printxyz Product'),
  category: String(product.category || 'Custom'),
  categorySlug: String(product.categorySlug || product.category || 'custom').toLowerCase().replace(/\s+/g, '-'),
  price: Number(product.price || 0),
  mrp: Number(product.mrp || product.price || 0),
  rating: Number(product.rating || 0),
  reviews: Number(product.reviews || 0),
  stock: Number(product.stock || 1),
  tags: Array.isArray(product.tags) ? product.tags : [],
  image: product.image || product.images?.[0] || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80',
  images: Array.isArray(product.images) && product.images.length ? product.images : [product.image || product.images?.[0] || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80'],
  videoUrl: product.videoUrl || product.video || '',
  published: product.published !== undefined ? Boolean(product.published) : true,
  description: product.description || 'A thoughtfully crafted Printxyz product made for everyday use and gifting.',
  badges: Array.isArray(product.badges) ? product.badges : ['Custom'],
  featured: Boolean(product.featured),
  section: product.section || 'popular'
});

const useCart = () => {
  const [cart, setCart] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('printxyz-cart') || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('printxyz-cart', JSON.stringify(cart));
  }, [cart]);

  const addToCart = (product, extra = {}) => {
    trackAddToCart(product, extra.quantity || 1);
    const optionsKey = extra.options ? `-c${[...JSON.stringify(extra.options)].reduce((h, c) => ((h * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36)}` : '';
    const item = {
      id: `${product.id}-${extra.variant || 'default'}-${extra.size || 'standard'}${optionsKey}`,
      options: extra.options || undefined,
      productId: product.id,
      slug: product.slug,
      title: product.title,
      image: product.image,
      price: product.price,
      quantity: extra.quantity || 1,
      variant: extra.variant || 'Standard',
      size: extra.size || null
    };

    setCart((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      if (existing) {
        return current.map((entry) =>
          entry.id === item.id ? { ...entry, quantity: entry.quantity + item.quantity } : entry
        );
      }
      return [...current, item];
    });
  };

  const updateQty = (itemId, delta) => {
    setCart((current) =>
      current
        .map((entry) => (entry.id === itemId ? { ...entry, quantity: Math.max(0, entry.quantity + delta) } : entry))
        .filter((entry) => entry.quantity > 0)
    );
  };

  const removeItem = (itemId) => setCart((current) => current.filter((entry) => entry.id !== itemId));
  const clearCart = () => setCart([]);

  return { cart, setCart, addToCart, updateQty, removeItem, clearCart };
};


function App() {
  const { cart, setCart, addToCart, updateQty, removeItem, clearCart } = useCart();
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [catalogReady, setCatalogReady] = useState(false);
  // Sessions live in httpOnly cookies set by the server. These flags only record "signed in" for the UI.
  const [adminToken, setAdminToken] = useState('');
  const [userToken, setUserToken] = useState('');
  const [cartSynced, setCartSynced] = useState(false);

  // Signed-in customers keep one cart on the server. On login, merge it with this device's cart (higher quantity wins).
  useEffect(() => {
    if (!userToken) { setCartSynced(false); return; }
    let live = true;
    fetch('/api/cart').then((r) => (r.ok ? r.json() : { items: [] })).then((d) => {
      if (!live) return;
      const server = Array.isArray(d.items) ? d.items : [];
      setCart((local) => {
        const merged = new Map(server.map((i) => [i.id, i]));
        for (const item of local) {
          const other = merged.get(item.id);
          merged.set(item.id, other ? { ...other, quantity: Math.max(other.quantity, item.quantity) } : item);
        }
        return [...merged.values()];
      });
      setCartSynced(true);
    }).catch(() => setCartSynced(true));
    return () => { live = false; };
  }, [userToken]);

  useEffect(() => {
    if (!userToken || !cartSynced) return undefined;
    const timer = setTimeout(() => {
      fetch('/api/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart }) }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [cart, userToken, cartSynced]);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.user) return;
      if (['owner', 'admin', 'manager', 'production', 'support'].includes(d.user.role)) setAdminToken('session');
      else setUserToken('session');
    }).catch(() => {});
  }, []);

  const signOut = async (clear) => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { clear(''); }
  };

  useEffect(() => {
    // Per-page titles, canonicals and structured data are set by each page with useSeo.
    fetch('/api/settings/public').then((r) => (r.ok ? r.json() : null)).then((d) => initTracking(d?.tracking?.metaPixelId, d?.tracking?.gaMeasurementId)).catch(() => initTracking(''));
    // Re-render once the live catalogue arrives, so a product link opened directly (ad, WhatsApp, search) is found.
    syncProductsFromApi().then((r) => { if (r) setCatalogVersion((v) => v + 1); }).finally(() => setCatalogReady(true));
  }, []);

  const addProduct = async (formData) => {
    const parsedImages = String(formData.images || formData.image || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const primaryImage = parsedImages[0] || formData.image || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80';

    const prepared = {
      ...formData,
      id: `p${Date.now()}`,
      slug: String(formData.title || 'custom-printxyz-product').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      price: Number(formData.price || 0),
      mrp: Number(formData.mrp || formData.price || 0),
      stock: Number(formData.stock || 1),
      section: formData.section || 'popular',
      featured: true,
      published: formData.published !== undefined ? Boolean(formData.published) : true,
      tags: String(formData.tags || '').split(',').map((entry) => entry.trim()).filter(Boolean),
      image: primaryImage,
      images: parsedImages.length ? parsedImages : [primaryImage],
      videoUrl: formData.videoUrl || ''
    };

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared)
      });

      if (response.ok) {
        await syncProductsFromApi();
      }
    } catch {
      // Offline: nothing is saved. The admin must retry once the server is reachable.
    }
  };

  const deleteProduct = async (productId) => {
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
        headers: {}
      });
      if (response.ok) {
        await syncProductsFromApi();
      }
    } catch {
      // Offline: nothing was deleted.
    }
  };

  const handleAdminLogin = async (payload) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      const err = new Error(data?.error?.message || 'Unable to sign in.');
      err.code = data?.error?.code;
      throw err;
    }

    setAdminToken('session');
    return data;
  };

  const handleUserLogin = async (payload) => {
    const response = await fetch('/api/auth/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Unable to sign in.');
    }

    setUserToken('session');
    return data;
  };

  const handleUserRegister = async (payload) => {
    const response = await fetch('/api/auth/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Unable to create account.');
    }

    setUserToken('session');
    return data;
  };

  const handleOtpRequest = async (email) => {
    const response = await fetch('/api/auth/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Unable to send OTP.');
    }

    return data;
  };

  const handleOtpVerify = async ({ email, otp }) => {
    const response = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'OTP verification failed.');
    }

    setUserToken('session');
    return data;
  };

  const handleGoogleLogin = async (credential) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Google sign-in failed.');
    }

    setUserToken('session');
    return data;
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const { pathname } = useLocation();
  useEffect(() => { pageView(); }, [pathname]);

  return (
    <div className="app-shell">
      {isPrivatePath(pathname) && <PrivateSeo pathname={pathname} />}
      <AnnouncementBar />
      <Header cartCount={cartCount} userToken={userToken} onUserLogout={() => signOut(setUserToken)} />
      <main>
        <Routes>
          <Route path="/" element={<HomePage key={catalogVersion} addToCart={addToCart} />} />
          <Route path="/category/:slug" element={<CategoryPage key={catalogVersion} addToCart={addToCart} />} />
          <Route path="/search" element={<SearchPage key={catalogVersion} addToCart={addToCart} />} />
          <Route path="/product/:slug" element={<ProductPage key={catalogVersion} addToCart={addToCart} catalogReady={catalogReady} />} />
          <Route path="/cart" element={<CartPage cart={cart} updateQty={updateQty} removeItem={removeItem} />} />
          <Route path="/checkout" element={<CheckoutPage cart={cart} clearCart={clearCart} />} />
          <Route path="/orders" element={<OrderHistoryPage userToken={userToken} />} />
          <Route path="/wishlist" element={<WishlistPage addToCart={addToCart} />} />
          <Route path="/track/:token" element={<OrderTrackingPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/size-guide" element={<SizeGuidePage />} />
          <Route path="/care" element={<CarePage />} />
          <Route path="/materials" element={<MaterialGuidePage />} />
          <Route path="/contact" element={<ContactForm kind="contact" />} />
          <Route path="/bulk-orders" element={<ContactForm kind="bulk" />} />
          <Route path="/policies/:slug" element={<StaticPage />} />
          <Route path="/account" element={<AccountPage userToken={userToken} onUserLogin={handleUserLogin} onUserRegister={handleUserRegister} onOtpRequest={handleOtpRequest} onOtpVerify={handleOtpVerify} onGoogleLogin={handleGoogleLogin} onLogout={() => signOut(setUserToken)} />} />
          <Route path="/login" element={<AccountPage userToken={userToken} onUserLogin={handleUserLogin} onUserRegister={handleUserRegister} onOtpRequest={handleOtpRequest} onOtpVerify={handleOtpVerify} onGoogleLogin={handleGoogleLogin} onLogout={() => signOut(setUserToken)} />} />
          <Route path="/admin" element={<ProtectedAdminPage adminToken={adminToken} onAddProduct={addProduct} onDeleteProduct={deleteProduct} handleAdminLogin={handleAdminLogin} onLogout={() => signOut(setAdminToken)} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
      <CookieBanner />
    </div>
  );
}

// Cart, checkout, account, orders, tracking, login, admin and search are never indexed.
function PrivateSeo({ pathname }) {
  useSeo({ title: 'Printxyz', path: `/${pathname.split('/')[1] || ''}`, noindex: true });
  return null;
}

function AnnouncementBar() {
  return (
    <div className="announcement-bar">
      <span>Free shipping on orders above ₹1,499 • Custom products start from ₹1,299</span>
    </div>
  );
}

function Header({ cartCount, userToken, onUserLogout }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 12);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setSuggestions([]);
      return;
    }

    const matches = products.filter((product) => `${product.title} ${product.category}`.toLowerCase().includes(term.toLowerCase()));
    setSuggestions(matches.slice(0, 6));
  }, [query]);

  const submitSearch = (event) => {
    event.preventDefault();
    const value = query.trim();
    navigate(value ? `/search?q=${encodeURIComponent(value)}` : '/search');
    setSuggestions([]);
  };

  return (
    <header className={`site-header ${isScrolled ? 'scrolled' : ''}`}>
      <div className="container header-row">
        <Link to="/" className="brand" aria-label="Printxyz home">
          <img src="/logo.jpeg" alt="Printxyz logo" className="brand-logo-image" />
        </Link>

        <form className="search-wrap" onSubmit={submitSearch}>
          <input
            aria-label="Search products"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search custom gifts, decor and more"
          />
          <button type="submit">Search</button>
          {suggestions.length > 0 && (
            <div className="search-suggestions" aria-live="polite">
              {suggestions.map((product) => (
                <button key={product.id} type="button" onClick={() => {
                  navigate(`/product/${product.slug}`);
                  setQuery('');
                  setSuggestions([]);
                }}>
                  {product.title}
                </button>
              ))}
            </div>
          )}
        </form>

        <nav className="nav-actions" aria-label="Main navigation">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/category/devotional">Devotional</NavLink>
          <NavLink to="/category/custom-statues">Custom</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/gallery">Gallery</NavLink>
          <NavLink to="/about">About</NavLink>
          {userToken ? (
            <>
              <Link to="/account" className="account-link">My Account</Link>
              <button type="button" className="text-link small" onClick={onUserLogout}>Logout</button>
            </>
          ) : (
            <Link to="/account" className="account-link">Login</Link>
          )}
          <Link to="/cart" className="cart-pill">
            Cart <span>{cartCount}</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

const HOME_SECTION_TITLES = { trending: 'Trending', 'most-loved': 'Most Loved', bestsellers: 'Bestsellers', 'new-arrivals': 'New Arrivals', popular: 'Popular' };

function HomePage({ addToCart }) {
  const [activeBanner, setActiveBanner] = useState(0);
  const [heroBanners, setHeroBanners] = useState(banners);
  const [sectionKeys, setSectionKeys] = useState(['trending', 'most-loved']);
  useEffect(() => {
    fetch('/api/banners/active').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.items?.length) { setHeroBanners(d.items); setActiveBanner(0); } }).catch(() => {});
    fetch('/api/sections/home').then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.items)) setSectionKeys(d.items); }).catch(() => {});
  }, []);
  useSeo({
    title: 'Printxyz | Custom 3D Printed Gifts, Lithophanes & Home Decor in India', path: '/',
    description: 'Shop 3D-printed gifts, custom statues, lithophanes, name plates and devotional decor from Printxyz. Made to order and shipped across India with online payment.',
    jsonLd: [organizationLd(), websiteLd()]
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveBanner((current) => (current + 1) % heroBanners.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [heroBanners.length]);

  return (
    <>
      <section className="hero-section container">
        <div className="hero-banner">
          <img src={(heroBanners[activeBanner] || heroBanners[0]).imageDesktop} alt={(heroBanners[activeBanner] || heroBanners[0]).title} />
          <div className="hero-overlay">
            <p className="eyebrow">Made to order in India</p>
            <h1>{(heroBanners[activeBanner] || heroBanners[0]).title}</h1>
            <p>{(heroBanners[activeBanner] || heroBanners[0]).subtitle}</p>
            <div className="hero-actions">
              {/^https:/.test((heroBanners[activeBanner] || heroBanners[0]).link) ? <a href={(heroBanners[activeBanner] || heroBanners[0]).link} className="primary-btn" rel="noopener">{(heroBanners[activeBanner] || heroBanners[0]).buttonText}</a> : <Link to={(heroBanners[activeBanner] || heroBanners[0]).link} className="primary-btn">{(heroBanners[activeBanner] || heroBanners[0]).buttonText}</Link>}
              <Link to="/gallery" className="secondary-btn">View gallery</Link>
            </div>
            <div className="hero-dots" aria-label="Banner indicators">
              {heroBanners.map((banner, index) => (
                <button
                  key={banner.id}
                  type="button"
                  className={index === activeBanner ? 'dot active' : 'dot'}
                  onClick={() => setActiveBanner(index)}
                  aria-label={`Go to banner ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="container home-section">
        <div className="section-heading-row">
          <h2>Shop by category</h2>
        </div>
        <div className="category-strip">
          {categories.map((category) => (
            <Link key={category.id} to={`/category/${category.slug}`} className="category-card">
              <span className="category-icon">{category.icon}</span>
              <span>{category.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {sectionKeys.map((key) => {
        const rows = products.filter((product) => product.section === key);
        if (!rows.length) return null;
        return (
          <section key={key} className="container home-section" data-testid={`home-section-${key}`}>
            <SectionHeading title={HOME_SECTION_TITLES[key] || key} action="View all" to={`/search?q=${encodeURIComponent(HOME_SECTION_TITLES[key] || key)}`} />
            <ProductGrid products={rows} addToCart={addToCart} />
          </section>
        );
      })}

      <section className="container trust-strip">
        <div><strong>Made to order</strong><span>Custom design support</span></div>
        <div><strong>Secure payments</strong><span>UPI, cards & netbanking</span></div>
        <div><strong>Preview before printing</strong><span>Approval before production</span></div>
        <div><strong>Pan-India delivery</strong><span>Tracked shipping</span></div>
      </section>

      <section className="container home-section custom-products">
        <div className="custom-copy">
          <p className="eyebrow">Custom gifts</p>
          <h2>Make it yours with a memory, name or photo</h2>
          <p>Turn a photo, idea or special date into a keepsake that feels personal.</p>
          <Link to="/category/custom-statues" className="primary-btn">Create custom gift</Link>
        </div>
        <div className="custom-image-grid">
          <img src="https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80" alt="Custom product example" />
          <img src="https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80" alt="Lithophane product" />
        </div>
      </section>

      <RecentReviews />

      <section className="container home-section">
        <SectionHeading title="Recent blog posts" action="Explore more" to="/gallery" />
        <div className="blog-grid">
          {blogPosts.map((post) => (
            <article key={post.slug} className="blog-card">
              <div className="blog-thumb" style={{ backgroundImage: `url(${galleryItems[Math.floor(Math.random() * galleryItems.length)]})` }} />
              <div className="blog-copy">
                <h3>{post.title}</h3>
                <p>{post.excerpt}</p>
                <Link to="/gallery">Read more</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="container home-section faq-section">
        <div className="section-heading-row">
          <h2>Frequently asked questions</h2>
        </div>
        <div className="faq-grid">
          <article className="faq-card">
            <h3>How long does custom production take?</h3>
            <p>Most custom pieces take 5 to 10 working days after design approval, depending on size and complexity.</p>
          </article>
          <article className="faq-card">
            <h3>Can I request personalization?</h3>
            <p>Yes. You can send photo references, names or dates at checkout and our team will review the design before printing.</p>
          </article>
          <article className="faq-card">
            <h3>Do you ship across India?</h3>
            <p>We deliver pan-India with tracked shipping and secure packaging for fragile items and large decor pieces.</p>
          </article>
        </div>
      </section>

      <section className="container home-section">
        <div className="newsletter-box">
          <div>
            <p className="eyebrow">Stay updated</p>
            <h2>Get exclusive discounts and new launch alerts</h2>
          </div>
          <form className="newsletter-form">
            <input type="email" placeholder="Your email address" aria-label="Email address" />
            <button type="submit" className="primary-btn">Join now</button>
          </form>
        </div>
      </section>
    </>
  );
}

function CategoryPage({ addToCart }) {
  const { slug } = useParams();
  const category = categories.find((entry) => entry.slug === slug);
  if (!category) return <NotFoundPage />;
  return <CategoryView category={category} slug={slug} addToCart={addToCart} />;
}

function CategoryView({ category, slug, addToCart }) {
  useSeo({
    title: `${category.name} | Printxyz`, path: `/category/${category.slug}`,
    description: `Browse ${category.name.toLowerCase()} from Printxyz. 3D-printed in India, made to order and delivered across India.`,
    jsonLd: breadcrumbLd([{ name: 'Home', path: '/' }, { name: category.name, path: `/category/${category.slug}` }])
  });
  const items = products.filter((product) => product.categorySlug === slug || product.category === category.name);

  return (
    <div className="container page-shell">
      <div className="page-header">
        <p className="eyebrow">Category</p>
        <h1>{category.name}</h1>
      </div>
      <ProductGrid products={items} addToCart={addToCart} />
    </div>
  );
}

function SearchPage({ addToCart }) {
  const [searchParams] = useSearchParams();
  const [sort, setSort] = useState('featured');
  const query = searchParams.get('q') || '';
  const items = useMemo(() => getVisibleProducts(products, query, sort), [query, sort]);

  return (
    <div className="container page-shell">
      <div className="page-header split-header">
        <div>
          <p className="eyebrow">Search results</p>
          <h1>{query ? `Results for “${query}”` : 'All products'}</h1>
        </div>
        <label className="sort-box">
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="rating">Top Rated</option>
          </select>
        </label>
      </div>

      {items.length ? <ProductGrid products={items} addToCart={addToCart} /> : <EmptyState text="No products found. Try another keyword." />}
    </div>
  );
}

function ProductPage({ addToCart, catalogReady = true }) {
  const { slug } = useParams();
  const product = products.find((entry) => entry.slug === slug);
  if (!product) return catalogReady ? <NotFoundPage /> : <div className="container page-shell"><p className="tiny-note" role="status">Loading…</p></div>;
  return <ProductDetail product={product} addToCart={addToCart} />;
}

function ProductDetail({ product, addToCart }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  useSeo({
    title: `${product.title} | Printxyz`, path: `/product/${product.slug}`, image: product.image,
    description: String(product.description || `${product.title} from Printxyz.`).slice(0, 160),
    jsonLd: [productLd(product), breadcrumbLd([{ name: 'Home', path: '/' }, { name: product.category, path: `/category/${product.categorySlug}` }, { name: product.title, path: `/product/${product.slug}` }])]
  });
  useEffect(() => { trackViewContent(product); }, [product.id]);
  const gallerySources = [
    ...(Array.isArray(product.images) ? product.images.map((image) => ({ type: 'image', url: image })) : [{ type: 'image', url: product.image }]),
    ...(product.videoUrl ? [{ type: 'video', url: product.videoUrl }] : [])
  ];
  const [selectedMedia, setSelectedMedia] = useState(gallerySources[0]);
  const [activeTab, setActiveTab] = useState('description');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [custom, setCustom] = useState({ photos: [], note: '' });
  const customizable = isCustomProduct(product);
  const blocked = customizable && needsPhoto(product) && !custom.photos.length;

  useEffect(() => {
    setCustom({ photos: [], note: '' });
    setSelectedMedia(gallerySources[0]);
    setZoomLevel(1);
    setActiveTab('description');
  }, [product, slug]);

  const handleBuyNow = () => {
    if (blocked) return;
    addToCart(product, { quantity: 1, options: toCartOptions(custom) });
    navigate('/checkout');
  };

  const handleZoom = (direction) => {
    setZoomLevel((current) => {
      const next = direction === 'in' ? Math.min(current + 0.2, 2) : Math.max(current - 0.2, 1);
      return Number(next.toFixed(2));
    });
  };

  return (
    <div className="container product-page">
      <div className="product-gallery">
        <div className="thumbs">
          {gallerySources.map((item, index) => (
            <button key={`${item.type}-${item.url}-${index}`} type="button" className={selectedMedia && selectedMedia.url === item.url && selectedMedia.type === item.type ? 'thumb active' : 'thumb'} onClick={() => setSelectedMedia(item)}>
              {item.type === 'video' ? <span className="video-thumb-label">▶</span> : <img src={item.url} alt={product.title} />}
            </button>
          ))}
        </div>
        <div className="main-gallery-image">
          <div className="gallery-zoom-controls">
            <button type="button" onClick={() => handleZoom('out')}>−</button>
            <span>{zoomLevel.toFixed(1)}×</span>
            <button type="button" onClick={() => handleZoom('in')}>＋</button>
          </div>
          {selectedMedia?.type === 'video' ? (
            <video className="video-frame" controls muted playsInline autoPlay loop src={selectedMedia.url} />
          ) : (
            <img src={selectedMedia?.url || product.image} alt={product.title} style={{ transform: `scale(${zoomLevel})` }} />
          )}
        </div>
      </div>

      <div className="product-info">
        <p className="eyebrow">{product.category}</p>
        <h1>{product.title}</h1>
        <div className="rating-line">
          {product.reviews > 0 ? (<><span>★ {product.rating}</span><span>({product.reviews} {product.reviews === 1 ? 'review' : 'reviews'})</span></>) : <span>No reviews yet</span>}
        </div>

        <div className="price-row">
          <strong>{formatMoney(product.price)}</strong>
          <span className="mrp">{formatMoney(product.mrp)}</span>
          <span className="save-badge">Save {Math.round(((product.mrp - product.price) / product.mrp) * 100)}%</span>
        </div>

        <p className="product-description">{product.description}</p>

        <div className="variant-box">
          <div className="option-row"><span>Stock</span><strong>{product.stock} available</strong></div>
        </div>

        {customizable && <CustomOptions product={product} value={custom} onChange={setCustom} />}
        <PincodeCheck />
        <WishlistButton productId={product.id} />

        <div className="cta-row">
          <button type="button" className="primary-btn" disabled={blocked} onClick={() => addToCart(product, { quantity: 1, options: toCartOptions(custom) })}>Add to Cart</button>
          <button type="button" className="secondary-btn" disabled={blocked} onClick={handleBuyNow}>Buy Now</button>
        </div>
        {blocked && <p className="tiny-note">Upload a photo to continue.</p>}

      </div>

      <div className="product-detail-panel">
        <div className="tabs">
          {['description', 'reviews'].map((tab) => (
            <button key={tab} type="button" className={activeTab === tab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab)}>
              {tab === 'description' ? 'Description' : 'Reviews'}
            </button>
          ))}
        </div>

        {activeTab === 'description' && (
          <div className="panel-body">
            <p>{product.description || 'Details for this product are coming soon.'}</p>
          </div>
        )}

        {activeTab === 'reviews' && <ProductReviews slug={product.slug} />}
      </div>
    </div>
  );
}

function CartPage({ cart, updateQty, removeItem }) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const [coupon, setCoupon] = useState('');
  const [couponMessage, setCouponMessage] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);

  const handleCouponApply = async () => {
    const normalized = coupon.trim().toUpperCase();
    try {
      const response = await fetch('/api/cart/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalized, items: cart.map((item) => ({ productId: item.productId || item.id, quantity: item.quantity })) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Coupon code not valid.');
      setCouponMessage(data.message || 'Coupon applied.');
      setAppliedCoupon({ code: normalized, discount: data.discount });
      try { sessionStorage.setItem('printxyz-coupon', normalized); } catch { /* ignore */ }
    } catch (error) {
      setCouponMessage(error.message || 'Coupon code not valid.');
      setAppliedCoupon(null);
      try { sessionStorage.removeItem('printxyz-coupon'); } catch { /* ignore */ }
    }
  };

  const discount = appliedCoupon ? appliedCoupon.discount : 0;

  const total = Math.max(subtotal - discount, 0);

  if (!cart.length) {
    return (
      <div className="container page-shell center-block">
        <EmptyState text="Your cart is empty. Add a few special pieces and come back here." />
        <Link to="/" className="primary-btn">Continue shopping</Link>
      </div>
    );
  }

  return (
    <div className="container page-shell cart-layout">
      <div className="cart-list">
        {cart.map((item) => (
          <article key={item.id} className="cart-item">
            <img src={item.image} alt={item.title} />
            <div className="cart-copy">
              <h3>{item.title}</h3>
              <p>{item.variant}</p>
              {item.options && <p className="tiny-note">Personalised{item.options.photos?.length ? `: ${item.options.photos.length} photo(s)` : ''}{item.options.note ? ` · “${item.options.note.slice(0, 60)}”` : ''}</p>}
              <div className="qty-box">
                <button type="button" onClick={() => updateQty(item.id, -1)}>-</button>
                <span>{item.quantity}</span>
                <button type="button" onClick={() => updateQty(item.id, 1)}>+</button>
              </div>
            </div>
            <div className="cart-price-wrap">
              <strong>{formatMoney(item.price * item.quantity)}</strong>
              <button type="button" className="text-link" onClick={() => removeItem(item.id)}>Remove</button>
            </div>
          </article>
        ))}
      </div>

      <aside className="summary-box">
        <h3>Order summary</h3>
        <div className="summary-row"><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div>
        <div className="summary-row"><span>Shipping</span><strong>Free</strong></div>
        <div className="summary-row"><span>Discount</span><strong>-{formatMoney(discount)}</strong></div>

        <div className="coupon-box">
          <input value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="Coupon code" />
          <button type="button" onClick={handleCouponApply}>Apply</button>
        </div>
        {couponMessage && <p className="coupon-message">{couponMessage}</p>}

        <div className="summary-row total"><span>Total</span><strong>{formatMoney(total)}</strong></div>
        <Link to="/checkout" className="primary-btn full-width">Proceed to checkout</Link>
      </aside>
    </div>
  );
}

function CheckoutPage({ cart, clearCart }) {
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const errorRef = useRef(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '', street: '', apartment: '', landmark: '',
    city: '', state: '', pincode: '', country: 'India'
  });
  const [agreed, setAgreed] = useState(false);
  const [quote, setQuote] = useState(null);
  const [trackingToken, setTrackingToken] = useState('');
  const couponCode = (() => { try { return sessionStorage.getItem('printxyz-coupon') || ''; } catch { return ''; } })();
  const cartItems = cart.map((item) => ({ productId: item.productId || item.id, quantity: item.quantity, ...(item.options ? { options: item.options } : {}) }));
  const [plan, setPlan] = useState('full');
  const [gstNote, setGstNote] = useState(0);
  useEffect(() => { fetch('/api/settings/public').then((r) => (r.ok ? r.json() : null)).then((d) => setGstNote(d?.gst?.enabled ? d.gst.ratePercent : 0)).catch(() => {}); }, []);
  const pin = /^[1-9]\d{5}$/.test(String(form.pincode).replace(/\s+/g, '')) ? String(form.pincode).replace(/\s+/g, '') : '';
  useEffect(() => { if (cart.length) trackInitiateCheckout(cartItems, cart.reduce((n, i) => n + i.price * i.quantity, 0)); }, []);

  // The server prices the cart. The page only displays what it returns.
  useEffect(() => {
    let live = true;
    // Debounced: asks the couriers for a live rate once the pincode is complete.
    const timer = setTimeout(() => {
      fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cartItems, couponCode, pincode: pin }) })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => { if (!live) return; setQuote(ok ? d : null); setQuoteError(ok ? '' : (d?.error?.message || 'Could not price your cart. Remove the item and add it again.')); })
        .catch(() => { if (live) { setQuote(null); setQuoteError('Could not reach the server. Check your connection.'); } });
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [cart.length, couponCode, pin]);

  const validateForm = () => {
    const required = [form.firstName, form.lastName, form.phone, form.email, form.street, form.city, form.state, form.pincode];
    if (required.some((value) => !String(value).trim())) {
      return 'Please fill in your full delivery details, including name, address, city, state, and pincode.';
    }
    if (!/^[1-9][0-9]{5}$/.test(String(form.pincode).replace(/\s+/g, ''))) return 'Please enter a valid 6-digit pincode.';
    if (!/^(\+91)?[6-9][0-9]{9}$/.test(String(form.phone).replace(/[\s-]/g, ''))) return 'Please enter a valid 10-digit mobile number.';
    if (!agreed) return 'Please accept the order terms and delivery policy to continue.';
    return '';
  };

  const showError = (message) => {
    setPaymentError(message);
    setTimeout(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const handleRazorpayCheckout = async (event) => {
    event?.preventDefault?.();
    setPaymentError('');
    const validationError = validateForm();
    if (validationError) {
      showError(validationError);
      return;
    }
    if (quote?.deliveryAvailable === false) {
      showError('Sorry, we cannot deliver to this pincode yet.');
      return;
    }

    setIsProcessing(true);
    try {
      // 1) The server creates the order and freezes prices. The browser sends no amounts.
      const orderResponse = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { ...form, name: `${form.firstName} ${form.lastName}`.trim() },
          items: cartItems,
          couponCode,
          paymentPlan: quote?.advance?.eligible ? plan : 'full',
          attribution: getAttributionForOrder(),
          marketingConsent: hasMarketingConsent()
        })
      });
      const orderData = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderData?.error?.message || 'Unable to create your order.');
      const order = orderData.item;

      // 2) The Razorpay order is created from the stored order's amount.
      const response = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, guestToken: order.guest_token })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Unable to start payment.');
      if (!data.keyId || !data.order?.id) throw new Error('Payments are not available right now. Please try again later.');

      if (!window.Razorpay) {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Unable to load the payment window. Check your connection and retry.'));
          document.body.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error('Payment window is not available.');

      const razorpay = new window.Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: 'Printxyz',
        description: `Order ${order.id}`,
        order_id: data.order.id,
        handler: async (paymentResponse) => {
          try {
            // 3) The server checks the signature and that this payment belongs to this stored order.
            const verifyResponse = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: paymentResponse.razorpay_order_id,
                razorpay_payment_id: paymentResponse.razorpay_payment_id,
                razorpay_signature: paymentResponse.razorpay_signature
              })
            });
            const verifyData = await verifyResponse.json();
            if (!verifyResponse.ok || !verifyData.ok) throw new Error(verifyData?.error?.message || 'Payment verification failed.');
            // Browser Purchase fires only after the server verified the payment; same event_id as the server event.
            trackPurchase({ orderId: order.id, value: order.total, items: cartItems });
            setOrderId(order.id);
            setTrackingToken(order.guest_token);
            setSubmitted(true);
            try { sessionStorage.removeItem('printxyz-coupon'); } catch { /* ignore */ }
            clearCart();
          } catch (verifyError) {
            setPaymentError(`${verifyError.message} If money was deducted, do not pay again. Quote order ${order.id} when you contact support.`);
          } finally {
            setIsProcessing(false);
          }
        },
        prefill: { name: `${form.firstName} ${form.lastName}`.trim(), email: form.email, contact: form.phone },
        theme: { color: '#0f172a' },
        modal: { ondismiss: () => setIsProcessing(false) }
      });
      razorpay.on?.('payment.failed', () => { showError('Payment failed. You can try again.'); setIsProcessing(false); });
      razorpay.open();
    } catch (error) {
      showError(error.message || 'Payment could not be completed.');
      setIsProcessing(false);
    }
  };

  // After a verified payment the cart is cleared; show the confirmation (and the tracking link) instead of an empty cart.
  if (submitted) {
    return (
      <div className="container page-shell center-block" data-testid="order-confirmed">
        <p className="success-text" role="status">
          Payment received. Order {orderId} is confirmed. <Link to={`/track/${encodeURIComponent(trackingToken)}`}>Track your order</Link>.
          {' '}Save this link: anyone with it can view this order's status.
        </p>
        <Link to="/" className="primary-btn">Continue shopping</Link>
      </div>
    );
  }

  if (!cart.length) {
    return (
      <div className="container page-shell center-block">
        <EmptyState text="Add an item before checkout." />
      </div>
    );
  }

  return (
    <div className="container page-shell checkout-shell">
      <div className="checkout-panel">
        <h1>Checkout</h1>
        <form onSubmit={handleRazorpayCheckout} className="checkout-form" noValidate>
          <AddressPicker onPick={(a) => { const [firstName, ...rest] = String(a.name || '').split(' '); setForm((cur) => ({ ...cur, firstName: firstName || '', lastName: rest.join(' '), phone: a.phone || '', street: a.street || '', apartment: a.apartment || '', landmark: a.landmark || '', city: a.city || '', state: a.state || '', pincode: a.pincode || '' })); }} />
          <div className="field-row">
            <label>
              First name
              <input type="text" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
            </label>
            <label>
              Last name
              <input type="text" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            </label>
          </div>
          <div className="field-row">
            <label>
              Phone
              <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
          </div>

          <label>
            Street address
            <input type="text" value={form.street} onChange={(event) => setForm({ ...form, street: event.target.value })} placeholder="House no., street, sector" />
          </label>
          <label>
            Apartment / building / flat
            <input type="text" value={form.apartment} onChange={(event) => setForm({ ...form, apartment: event.target.value })} placeholder="Apartment, floor, building name" />
          </label>
          <label>
            Landmark
            <input type="text" value={form.landmark} onChange={(event) => setForm({ ...form, landmark: event.target.value })} placeholder="Nearest landmark" />
          </label>

          <div className="field-row">
            <label>
              City
              <input type="text" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </label>
            <label>
              State
              <select value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>
                <option value="">Select state</option>
                {form.state && !INDIAN_STATES.includes(form.state) && <option value={form.state}>{form.state}</option>}
                {INDIAN_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label>
              Pincode
              <input type="text" value={form.pincode} onChange={(event) => setForm({ ...form, pincode: event.target.value })} />
            </label>
            <label>
              Country
              <input type="text" value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} />
            </label>
          </div>

          <PincodeCheck initial={form.pincode} />

          {quote?.advance?.eligible && (
            <fieldset className="plan-choice" data-testid="plan-choice">
              <legend>How would you like to pay?</legend>
              <label className="checkbox-row"><input type="radio" name="plan" value="full" checked={plan === 'full'} onChange={() => setPlan('full')} /> Pay in full now ({formatMoney(quote.total)})</label>
              <label className="checkbox-row"><input type="radio" name="plan" value="advance" checked={plan === 'advance'} onChange={() => setPlan('advance')} /> Pay {quote.advance.percent}% advance now ({formatMoney(quote.advance.advance)}), balance {formatMoney(quote.advance.balance)} before we ship</label>
            </fieldset>
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            I agree to the order terms and delivery policy.
          </label>
          <button type="submit" className="primary-btn" disabled={isProcessing || quote?.deliveryAvailable === false}>{isProcessing ? 'Processing...' : (quote?.advance?.eligible && plan === 'advance' ? `Pay ${formatMoney(quote.advance.advance)} advance securely` : 'Pay securely with Razorpay')}</button>
          {quote && quote.deliveryAvailable === false && <p className="notice-text error">Sorry, we cannot deliver to this pincode yet.</p>}
          {submitted && (
            <p className="success-text">
              Payment received. Order {orderId} is confirmed. <Link to={`/track/${encodeURIComponent(trackingToken)}`}>Track your order</Link>. Save this link: anyone with it can view this order's progress.
            </p>
          )}
          {quoteError && !paymentError && <p className="notice-text error">{quoteError}</p>}
          {paymentError && <p ref={errorRef} role="alert" className="notice-text error">{paymentError}</p>}
        </form>
      </div>

      <aside className="summary-box">
        <h3>Payment summary</h3>
        <div className="summary-row"><span>Subtotal</span><strong>{quote ? formatMoney(quote.subtotal) : '…'}</strong></div>
        {quote && quote.discount > 0 && <div className="summary-row"><span>Discount ({quote.couponCode})</span><strong>-{formatMoney(quote.discount)}</strong></div>}
        <div className="summary-row"><span>Shipping{quote?.shippingCourier ? ` (${quote.shippingCourier})` : ''}</span><strong>{!quote ? '…' : !pin ? 'Enter pincode' : quote.shipping === 0 ? 'Free' : formatMoney(quote.shipping)}</strong></div>
        <div className="summary-row total"><span>Total</span><strong>{quote ? formatMoney(quote.total) : '…'}</strong></div>
        {quote?.advance?.eligible && plan === 'advance' && <div className="summary-row"><span>Due now</span><strong>{formatMoney(quote.advance.advance)}</strong></div>}
        <p className="muted-text">{gstNote ? `All prices include GST (${gstNote}%). ` : ''}Online payment only.</p>

      </aside>
    </div>
  );
}

function GalleryPage() {
  useSeo({ title: 'Gallery of 3D Printed Creations | Printxyz', path: '/gallery', description: 'See finished 3D-printed gifts, statues, lithophanes and decor made by Printxyz.', jsonLd: breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Gallery', path: '/gallery' }]) });
  return (
    <div className="container page-shell">
      <div className="page-header">
        <p className="eyebrow">Gallery</p>
        <h1>Made with love</h1>
      </div>
      <div className="gallery-grid">
        {galleryItems.map((image, index) => (
          <img key={`${image}-${index}`} src={image} alt="Finished Printxyz creation" className="gallery-item" />
        ))}
      </div>
    </div>
  );
}

function OrderHistoryPage({ userToken }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadOrders = async () => {
      if (userToken) {
        try {
          const response = await fetch('/api/customer/orders', {
            headers: {}
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error?.message || 'Unable to load your orders.');
          setOrders(Array.isArray(data.items) ? data.items : []);
          setError('');
          return;
        } catch (requestError) {
          setError(requestError.message || 'Unable to load your orders.');
        }
      }

      setOrders([]);
    };

    loadOrders();
  }, [userToken]);

  if (error) {
    return (
      <div className="container page-shell center-block">
        <EmptyState text={error} />
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="container page-shell center-block">
        <EmptyState text="No orders yet. Complete a purchase to see it here." />
      </div>
    );
  }

  return (
    <div className="container page-shell">
      <div className="page-header">
        <p className="eyebrow">My orders</p>
        <h1>Order history</h1>
      </div>
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr><th>Order</th><th>Date</th><th>Payment</th><th>Production</th><th>Tracking</th></tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td><Link to={`/track/${encodeURIComponent(order.guest_token || '')}`}>{order.id}</Link></td>
                <td>{new Date(order.createdAt || Date.now()).toLocaleDateString('en-IN')}</td>
                <td>{order.payment_status || 'pending'}</td>
                <td>{order.production_status || 'awaiting-approval'}</td>
                <td>{order.tracking_number ? order.tracking_number : 'Pending'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderTrackingPage() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [changeNote, setChangeNote] = useState('');
  const [decisionMessage, setDecisionMessage] = useState('');
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(`/api/orders/track/${encodeURIComponent(token || '')}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || 'Order not found.');
        if (active) setOrder(data.item);
      } catch (err) {
        if (active) setError(err.message || 'Unable to load order.');
      }
    };

    load();
    return () => { active = false; };
  }, [token, reload]);

  const decide = async (action) => {
    setDeciding(true);
    setDecisionMessage('');
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestToken: token, action, note: changeNote })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Could not save your decision.');
      setDecisionMessage(action === 'approve' ? 'Thank you. Your design is approved and goes into production.' : 'Thanks. We will send an updated preview soon.');
      setChangeNote('');
      setReload((value) => value + 1);
    } catch (err) {
      setDecisionMessage(err.message || 'Could not save your decision.');
    } finally {
      setDeciding(false);
    }
  };

  if (error) {
    return (
      <div className="container page-shell center-block">
        <EmptyState text={error} />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container page-shell center-block">
        <EmptyState text="Loading order details…" />
      </div>
    );
  }

  return (
    <div className="container page-shell">
      <div className="page-header">
        <p className="eyebrow">Track order</p>
        <h1>{order.id}</h1>
      </div>

      <div className="admin-panel-grid">
        <div className="admin-form-card">
          <h3>Order status</h3>
          <p><strong>Payment:</strong> {order.payment_status || 'pending'}</p>
          <p><strong>Production:</strong> {order.production_status || 'awaiting-approval'}</p>
          <p><strong>Shipping:</strong> {order.shipping_status || 'pending'}</p>
          {order.custom_preview_status && order.custom_preview_status !== 'not-required' && <p><strong>Design preview:</strong> {order.custom_preview_status}</p>}
          {order.courier_name && <p><strong>Courier:</strong> {order.courier_name}</p>}
          {order.tracking_number && <p><strong>Tracking:</strong> {order.tracking_number}</p>}
          {order.estimated_delivery && <p><strong>Estimated delivery:</strong> {order.estimated_delivery}</p>}
          {order.tracking_url && <a href={order.tracking_url} target="_blank" rel="noreferrer" className="primary-btn small-btn">Open courier tracking</a>}
          {order.payment_status === 'advance_paid' && <p><strong>Paid so far:</strong> {formatMoney(order.paid_amount)} of {formatMoney(order.total)}</p>}
          {order.payment_status === 'paid' && <p><a href={`/api/orders/${encodeURIComponent(order.id)}/invoice?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">View invoice</a></p>}
        </div>

        <PaymentPlan order={order} token={token} onDone={() => setReload((n) => n + 1)} />
        <ReturnRequest order={order} token={token} />

        {order.custom_preview_status === 'preview-ready' && (
          <div className="admin-form-card">
            <h3>Your design preview is ready</h3>
            {order.preview_note && <p>{order.preview_note}</p>}
            {order.preview_url && <p><a href={order.preview_url} target="_blank" rel="noreferrer">Open the preview</a></p>}
            <p>Production starts only after you approve.</p>
            <button type="button" className="primary-btn" disabled={deciding} onClick={() => decide('approve')}>Approve design</button>
            <label>
              Want changes? Tell us what to adjust
              <textarea value={changeNote} onChange={(event) => setChangeNote(event.target.value)} rows={3} maxLength={600} />
            </label>
            <button type="button" className="secondary-btn" disabled={deciding || changeNote.trim().length < 5} onClick={() => decide('request_changes')}>Request changes</button>
          </div>
        )}
        {decisionMessage && <p className="notice-text">{decisionMessage}</p>}
        {order.status === 'confirmed' && order.shipping_status === 'pending' && (
          <CancelOrder orderId={order.id} guestToken={token} onDone={() => setReload((n) => n + 1)} />
        )}

        <div className="admin-form-card">
          <h3>Items</h3>
          {Array.isArray(order.items) && order.items.map((item) => (
            <div key={`${item.id}-${item.title}`} className="cart-item">
              <img src={item.image} alt={item.title} />
              <div className="cart-copy">
                <h3>{item.title}</h3>
                <p>Quantity: {item.quantity}</p>
              </div>
            </div>
          ))}
          {order.total > 0 && <p><strong>Order total:</strong> {formatMoney(order.total)}</p>}
        </div>
      </div>
    </div>
  );
}

function StaticPage({ slug }) {
  const params = useParams();
  const currentSlug = slug || params.slug || 'about';

  const pages = {
    about: {
      title: 'About Printxyz',
      body: 'Printxyz creates premium 3D-printed gifting and decor pieces for modern Indian homes. From custom keepsakes to devotional decor, we design products that feel personal and lasting.'
    },
    shipping: {
      title: 'Shipping policy',
      body: 'All orders are packed carefully and shipped across India. Custom products go through a preview approval process before production begins.'
    },
    refund: {
      title: 'Returns and refunds',
      body: 'Custom items cannot be cancelled once production begins. Damage claims should be reported within 24 to 48 hours with photos or an unboxing video.'
    },
    privacy: {
      title: 'Privacy policy',
      body: 'We use customer information only to complete and improve your order and communication experience. We do not sell personal data. With your permission we also use marketing cookies (Meta Pixel) to measure our advertising; you can change this choice at any time from Cookie settings in the footer.'
    },
    terms: {
      title: 'Terms and conditions',
      body: 'By placing an order, you agree to the price, delivery schedule and custom product approval policy communicated during checkout.'
    }
  };

  const page = pages[currentSlug];
  const staticPath = slug ? `/${slug}` : `/policies/${currentSlug}`;
  useSeo({
    title: page ? `${page.title} | Printxyz` : 'Page not found | Printxyz', path: staticPath, noindex: !page,
    description: page ? page.body.slice(0, 160) : undefined,
    jsonLd: page ? breadcrumbLd([{ name: 'Home', path: '/' }, { name: page.title, path: staticPath }]) : null
  });
  if (!page) return <NotFoundPage />;

  return (
    <div className="container page-shell static-page">
      <div className="page-header">
        <p className="eyebrow">Information</p>
        <h1>{page.title}</h1>
      </div>
      <div className="content-card">
        <p>{page.body}</p>
      </div>
    </div>
  );
}

function ProtectedAdminPage({ adminToken, ...props }) {
  return <AdminPage {...props} adminToken={adminToken} />;
}

function AdminPage({ onAddProduct, onDeleteProduct, adminToken, handleAdminLogin, onLogout }) {
  const [form, setForm] = useState({
    title: '',
    category: 'Devotional',
    price: '',
    mrp: '',
    stock: '10',
    image: '',
    images: '',
    videoUrl: '',
    published: true,
    tags: '',
    description: ''
  });
  const [notice, setNotice] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '', totp: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [needTotp, setNeedTotp] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setNotice('Product title is required.');
      return;
    }

    await onAddProduct({
      ...form,
      title: form.title.trim(),
      description: form.description.trim() || 'Custom crafted Printxyz product.'
    });

    setForm({
      title: '',
      category: 'Devotional',
      price: '',
      mrp: '',
      stock: '10',
      image: '',
      images: '',
      videoUrl: '',
      published: true,
      tags: '',
      description: ''
    });
    setNotice('Product added successfully.');
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      await handleAdminLogin({ ...loginForm, totp: loginForm.totp || undefined });
    } catch (error) {
      setNeedTotp(error.code === 'TOTP_REQUIRED' || error.code === 'INVALID_TOTP' || needTotp);
      setLoginError(error.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const [orders, setOrders] = useState([]);
  const [orderNotice, setOrderNotice] = useState('');

  const dashboardStats = {
    revenue: orders.filter((order) => order.payment_status === 'paid').reduce((sum, order) => sum + Number(order.total || 0), 0),
    orders: orders.length,
    customers: new Set(orders.map((order) => order.customer?.email).filter(Boolean)).size,
    active: products.filter((product) => product.stock > 0).length
  };

  useEffect(() => {
    if (!adminToken) return;

    const loadOrders = async () => {
      try {
        const response = await fetch('/api/orders', {
          headers: {}
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || 'Unable to load orders.');
        setOrders(Array.isArray(data.items) ? data.items : []);
      } catch (error) {
        setOrderNotice(error.message || 'Unable to load orders.');
      }
    };

    loadOrders();
  }, [adminToken]);

  if (!adminToken) {
    return (
      <div className="container page-shell center-block">
        <div className="admin-login-box">
          <p className="eyebrow">Admin access</p>
          <h1>Printxyz dashboard login</h1>
          <form className="admin-form" onSubmit={handleLogin}>
            <input type="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="Admin email" />
            <input type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Password" autoComplete="current-password" />
            {needTotp && <input inputMode="numeric" maxLength={6} value={loginForm.totp} onChange={(event) => setLoginForm({ ...loginForm, totp: event.target.value })} placeholder="6-digit authenticator code" autoComplete="one-time-code" />}
            <button type="submit" className="primary-btn" disabled={loginLoading}>{loginLoading ? 'Signing in...' : 'Sign in'}</button>
            {loginError && <p className="notice-text error">{loginError}</p>}
          </form>
          <p className="tiny-note">Only verified admin accounts can access this dashboard.</p>
        </div>
      </div>
    );
  }

  const reloadOrders = async () => {
    const refreshed = await fetch('/api/orders');
    const refreshedData = await refreshed.json();
    if (refreshed.ok) setOrders(Array.isArray(refreshedData.items) ? refreshedData.items : []);
  };

  const handleOrderStatusUpdate = async (orderId, patch) => {
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Unable to update order status.');
      setOrderNotice('Order updated successfully.');
      const refreshed = await fetch('/api/orders', { headers: {} });
      const refreshedData = await refreshed.json();
      if (refreshed.ok) setOrders(Array.isArray(refreshedData.items) ? refreshedData.items : []);
    } catch (error) {
      setOrderNotice(error.message || 'Unable to update order status.');
    }
  };

  return (
    <div className="container page-shell">
      <div className="page-header">
        <p className="eyebrow">Admin</p>
        <h1>Dashboard overview</h1>
        <button type="button" className="text-link danger" onClick={onLogout}>Log out</button>
      </div>

      <div className="admin-grid">
        <div className="admin-card"><span>Total catalogue value</span><strong>{formatMoney(dashboardStats.revenue)}</strong></div>
        <div className="admin-card"><span>Orders</span><strong>{dashboardStats.orders}</strong></div>
        <div className="admin-card"><span>Customers</span><strong>{dashboardStats.customers}</strong></div>
        <div className="admin-card"><span>Active stock</span><strong>{dashboardStats.active}</strong></div>
      </div>

      <AdminTools />
      <AdminCancellations />
      <div className="admin-panel-grid">
        <div className="admin-form-card">
          <h3>Add new product</h3>
          <form className="admin-form" onSubmit={handleSubmit}>
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Product title" />
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="Devotional">Devotional</option>
              <option value="Custom Statues">Custom Statues</option>
              <option value="Home Decor">Home Decor</option>
              <option value="Lithophanes">Lithophanes</option>
              <option value="Name Plates">Name Plates</option>
              <option value="Toys">Toys</option>
            </select>
            <div className="field-row small-gap">
              <input type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="Price" />
              <input type="number" value={form.mrp} onChange={(event) => setForm({ ...form, mrp: event.target.value })} placeholder="MRP" />
            </div>
            <div className="field-row small-gap">
              <input type="number" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="Stock" />
              <label className="checkbox-row inline-checkbox">
                <input type="checkbox" checked={form.published} onChange={(event) => setForm({ ...form, published: event.target.checked })} />
                Publish product
              </label>
            </div>
            <input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} placeholder="Primary image URL" />
            <input value={form.images} onChange={(event) => setForm({ ...form, images: event.target.value })} placeholder="Multiple images (comma separated URLs)" />
            <input value={form.videoUrl} onChange={(event) => setForm({ ...form, videoUrl: event.target.value })} placeholder="MP4 video URL (optional)" />
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="Tags (comma separated)" />
            <textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Short product description" />
            <button type="submit" className="primary-btn">Save product</button>
            {notice && <p className="notice-text">{notice}</p>}
          </form>
        </div>

        <div className="admin-panel-grid invoice-panel">
          <div className="admin-form-card">
            <h3>Billing & invoice</h3>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Price</th><th>Stock</th><th>Action</th></tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.title}</td>
                  <td>{formatMoney(product.price)}</td>
                  <td>{product.stock}</td>
                  <td><button type="button" className="text-link danger" onClick={() => onDeleteProduct(product.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-form-card" style={{ marginTop: '1.5rem' }}>
          <h3>Customer orders</h3>
          {orderNotice && <p className="notice-text">{orderNotice}</p>}
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th>Action</th></tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.id}</td>
                    <td>{order.customer?.name || order.customer_email || 'Guest'}</td>
                    <td>{order.status || 'Confirmed'}</td>
                    <td>{order.payment_status || 'pending'}</td>
                    <td>
                      <OrderActions order={order} onStatus={handleOrderStatusUpdate} onReload={reloadOrders} onNotice={setOrderNotice} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const NEXT_PRODUCTION = { 'awaiting-approval': 'approved', approved: 'queued', queued: 'printing', printing: 'quality-check', 'quality-check': 'packed' };

function OrderActions({ order, onStatus, onReload, onNotice }) {
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('shiprocket');
  const paid = order.payment_status === 'paid';
  const nextProduction = NEXT_PRODUCTION[order.production_status];
  const canRefund = ['paid', 'partially_refunded'].includes(order.payment_status);

  const run = async (label, fn) => {
    setBusy(true);
    try {
      await fn();
      await onReload();
    } catch (error) {
      onNotice(error.message || `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };
  const post = async (url, body, method = 'POST') => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Request failed.');
    return data;
  };
  const base = `/api/admin/orders/${encodeURIComponent(order.id)}`;

  return (
    <div className="admin-actions">
      {paid && nextProduction && (
        <button type="button" className="secondary-btn small-btn" disabled={busy}
          onClick={() => run('Update', async () => { await post(`${base}/status`, { production_status: nextProduction }, 'PATCH'); onNotice(`Production: ${nextProduction}`); })}>
          Production → {nextProduction}
        </button>
      )}
      {paid && order.is_custom && ['pending', 'changes-requested'].includes(order.custom_preview_status) && (
        <button type="button" className="secondary-btn small-btn" disabled={busy}
          onClick={() => {
            const previewUrl = window.prompt('Link (https://) to the design preview image or render:');
            if (!previewUrl) return;
            const note = window.prompt('Message to the customer (optional):') || '';
            run('Preview', async () => { await post(`${base}/preview`, { previewUrl, note }); onNotice('Preview sent to the customer.'); });
          }}>
          Send preview
        </button>
      )}
      {paid && order.production_status === 'packed' && !order.tracking_number && (
        <>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Courier">
            <option value="shiprocket">Shiprocket</option>
            <option value="delhivery">Delhivery</option>
          </select>
          <button type="button" className="primary-btn small-btn" disabled={busy}
            onClick={() => run('Shipment', async () => { const d = await post(`${base}/shipment`, { provider }); onNotice(`Shipment created. AWB ${d.shipment.awb}${d.shipment.labelUrl ? ' • label ready' : ''}`); })}>
            Create shipment
          </button>
        </>
      )}
      {order.tracking_number && (
        <>
          <span className="tiny-note">{order.courier_name} • {order.tracking_number}</span>
          <button type="button" className="secondary-btn small-btn" disabled={busy}
            onClick={() => run('Refresh', async () => { const d = await post(`${base}/shipment/refresh`); onNotice(`Courier says: ${d.courierStatus || 'no update yet'}`); })}>
            Refresh status
          </button>
          <button type="button" className="secondary-btn small-btn" disabled={busy}
            onClick={() => run('Label', async () => { const response = await fetch(`${base}/shipment`); const d = await response.json(); if (!response.ok || !d.shipment?.labelUrl) throw new Error('No label available yet.'); window.open(d.shipment.labelUrl, '_blank', 'noopener'); })}>
            Print label
          </button>
        </>
      )}
      {canRefund && (
        <button type="button" className="secondary-btn small-btn" disabled={busy}
          onClick={() => {
            const amount = window.prompt('Refund amount in rupees (leave empty for the full remaining amount):', '');
            if (amount === null) return;
            const reason = window.prompt('Reason for the refund (required):');
            if (!reason) return;
            run('Refund', async () => { const d = await post(`${base}/refund`, { amount: amount === '' ? undefined : Number(amount), reason }); onNotice(d.message); });
          }}>
          Refund
        </button>
      )}
    </div>
  );
}

function AccountPage({ userToken, onUserLogin, onUserRegister, onOtpRequest, onOtpVerify, onGoogleLogin, onLogout }) {
  const [mode, setMode] = useState('login');
  const [authMethod, setAuthMethod] = useState('password');
  const [form, setForm] = useState({ name: '', email: '', password: '', otp: '' });
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password
      };

      if (mode === 'register') {
        await onUserRegister(payload);
        setSuccess('Account created successfully.');
      } else {
        await onUserLogin({ email: form.email, password: form.password });
        setSuccess('Welcome back.');
      }
    } catch (requestError) {
      setError(requestError.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSend = async () => {
    if (!form.email.trim()) {
      setError('Enter your email first.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await onOtpRequest(form.email.trim().toLowerCase());
      setOtpSent(true);
      setSuccess(response?.devOtp ? `OTP sent. Dev code: ${response.devOtp}` : 'A one-time password has been sent to your email.');
    } catch (requestError) {
      setError(requestError.message || 'Unable to generate OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await onOtpVerify({ email: form.email.trim().toLowerCase(), otp: form.otp.trim() });
      setSuccess('OTP login successful.');
    } catch (requestError) {
      setError(requestError.message || 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  };

  const initializeGoogleClient = () => {
    if (!GOOGLE_CLIENT_ID || !window.google || !window.google.accounts || !window.google.accounts.id) {
      return false;
    }

    if (!window.__printxyzGoogleInitialized) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response?.credential) {
            setError('Google sign-in was cancelled.');
            return;
          }

          try {
            await onGoogleLogin(response.credential);
            setSuccess('Google sign-in successful.');
          } catch (requestError) {
            setError(requestError.message || 'Google sign-in failed.');
          }
        }
      });
      window.__printxyzGoogleInitialized = true;
    }

    return true;
  };

  useEffect(() => {
    initializeGoogleClient();

    const timer = window.setInterval(() => {
      if (initializeGoogleClient()) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [onGoogleLogin]);

  const handleGoogleContinue = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (!GOOGLE_CLIENT_ID) {
        throw new Error('Google login is not configured yet. Add VITE_GOOGLE_CLIENT_ID to the frontend env and GOOGLE_CLIENT_ID to the backend env.');
      }

      if (!initializeGoogleClient()) {
        throw new Error('Google Identity library is not loaded yet. Refresh the page or verify the client script is enabled.');
      }

      window.google.accounts.id.prompt();
    } catch (requestError) {
      setError(requestError.message || 'Google login is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  if (userToken) return <AccountPanel onLogout={onLogout} />;

  return (
    <div className="container page-shell account-page">
      <div className="account-panel">
        <p className="eyebrow">Account</p>
        <h1>{mode === 'login' ? 'Login to your account' : 'Create your account'}</h1>

        <div className="account-toggle">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>

        <div className="auth-methods">
          <button type="button" className={authMethod === 'password' ? 'active' : ''} onClick={() => setAuthMethod('password')}>Password</button>
          <button type="button" className={authMethod === 'otp' ? 'active' : ''} onClick={() => setAuthMethod('otp')}>Email OTP</button>
        </div>

        {authMethod === 'password' && (
          <form className="admin-form" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Full name" />
            )}
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email address" />
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Password" />
            <button type="submit" className="primary-btn" disabled={loading}>{loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}</button>
          </form>
        )}

        {authMethod === 'otp' && (
          <form className="admin-form" onSubmit={handleOtpVerify}>
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email address" />
            <div className="otp-box">
              <input type="text" inputMode="numeric" maxLength="6" value={form.otp} onChange={(event) => setForm({ ...form, otp: event.target.value.replace(/[^0-9]/g, '').slice(0, 6) })} placeholder="Enter OTP" />
              <button type="button" className="secondary-btn" onClick={handleOtpSend} disabled={loading}>{loading ? 'Sending...' : 'Send OTP'}</button>
            </div>
            <button type="submit" className="primary-btn" disabled={loading || !otpSent}>{loading ? 'Verifying...' : 'Verify OTP & login'}</button>
          </form>
        )}

        <div className="auth-divider">or</div>

        <div className="social-login">
          <button type="button" onClick={handleGoogleContinue} disabled={loading}>Continue with Google</button>
        </div>

        {error && <p className="notice-text error">{error}</p>}
        {success && <p className="notice-text success">{success}</p>}
      </div>
    </div>
  );
}

function WishlistPage({ addToCart }) {
  const [items, setItems] = useState(undefined);
  useEffect(() => { loadWishlistProducts().then(setItems).catch(() => setItems(null)); }, []);
  if (items === undefined) return <div className="container page-shell center-block"><EmptyState text="Loading your wishlist…" /></div>;
  if (items === null) return <div className="container page-shell center-block"><EmptyState text="Log in to see your wishlist." /></div>;
  if (!items.length) return <div className="container page-shell center-block"><EmptyState text="Your wishlist is empty. Tap the heart on any product to save it." /></div>;
  return (
    <div className="container page-shell">
      <div className="page-header"><p className="eyebrow">Saved</p><h1>My wishlist</h1></div>
      <ProductGrid products={items} addToCart={addToCart} />
    </div>
  );
}

function NotFoundPage() {
  useSeo({ title: 'Page not found | Printxyz', noindex: true });
  return (
    <div className="container page-shell center-block">
      <h1>Page not found</h1>
      <Link to="/" className="primary-btn">Back home</Link>
    </div>
  );
}

function SectionHeading({ title, action, to }) {
  return (
    <div className="section-heading-row">
      <h2>{title}</h2>
      {action && to ? <Link to={to}>{action}</Link> : null}
    </div>
  );
}

function ProductGrid({ products, addToCart }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <article key={product.id} className="product-card">
          <Link to={`/product/${product.slug}`} className="product-image-wrap">
            <img src={product.image} alt={product.title} />
            {product.badges && <span className="badge-row">{product.badges.slice(0, 2).map((badge) => <em key={badge}>{badge}</em>)}</span>}
          </Link>
          <div className="product-card-body">
            <div className="product-card-meta">
              <p>{product.category}</p>
              {product.reviews > 0 && <span>★ {product.rating}</span>}
            </div>
            <Link to={`/product/${product.slug}`} className="product-title-link">{product.title}</Link>
            <div className="price-row compact">
              <strong>{formatMoney(product.price)}</strong>
              <span>{formatMoney(product.mrp)}</span>
            </div>
            <button type="button" className="primary-btn small-btn" onClick={() => addToCart(product, { quantity: 1 })}>Add to cart</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state"><p>{text}</p></div>;
}

function Footer() {
  const [hasMaterialGuide, setHasMaterialGuide] = useState(false);
  useEffect(() => { fetch('/api/settings/public').then((r) => (r.ok ? r.json() : null)).then((d) => setHasMaterialGuide(Boolean(d?.features?.materialGuide))).catch(() => {}); }, []);
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="brand brand-footer">
            <span className="brand-mark" aria-hidden="true">
              <span className="mark-x" />
              <span className="mark-y" />
              <span className="mark-z" />
            </span>
            <span className="brand-text">Printxyz</span>
          </div>
          <p>3D printed gifts, custom keepsakes and home decor for meaningful living.</p>
        </div>
        <div>
          <h4>Shop</h4>
          <ul>
            {categories.map((c) => <li key={c.slug}><Link to={`/category/${c.slug}`}>{c.name}</Link></li>)}
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li><Link to="/about">About</Link></li>
            <li><Link to="/contact">Contact</Link></li>
            <li><Link to="/bulk-orders">Bulk orders</Link></li>
            <li><Link to="/gallery">Gallery</Link></li>
            <li><Link to="/faq">FAQ</Link></li>
            <li><Link to="/size-guide">Size guide</Link></li>
            <li><Link to="/care">Care guide</Link></li>
            {hasMaterialGuide && <li><Link to="/materials">Material guide</Link></li>}
          </ul>
        </div>
        <div>
          <h4>Policies</h4>
          <ul>
            <li><Link to="/policies/shipping">Shipping</Link></li>
            <li><Link to="/policies/refund">Refund</Link></li>
            <li><Link to="/policies/privacy">Privacy</Link></li>
            <li><Link to="/policies/terms">Terms</Link></li>
            <li><button type="button" className="link-btn" onClick={openCookieSettings}>Cookie settings</button></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

export default App;
