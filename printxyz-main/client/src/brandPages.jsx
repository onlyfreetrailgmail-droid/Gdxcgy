import { Link } from 'react-router-dom';
import { useSeo, faqLd, breadcrumbLd } from './seo';

// Facts below come from the store's own policies and code: online payment only, 2 free design revisions,
// design preview before production, 5 to 10 working days after approval, free shipping above Rs 1,499,
// customer photos deleted 90 days after an order finishes. Anything the owner must confirm is listed in
// docs/CONTENT_TODO.md and is not stated here.
export const FAQ_ITEMS = [
  { group: 'Ordering', q: 'What does Printxyz sell?', a: 'Printxyz sells 3D-printed gifts and home pieces: devotional decor, toys, home decor, lithophanes, custom statues and name plates. Everything is made to order and shipped within India.' },
  { group: 'Ordering', q: 'Which payment methods do you accept?', a: 'We accept online payments only, through Razorpay. Cash on delivery is not available. An order is confirmed only after your payment is verified by our server, not just when you return to the site.' },
  { group: 'Ordering', q: 'Can I get a personalised or custom piece?', a: 'Yes. Custom products such as statues and lithophanes are based on your photo, name or date. Our team reviews the design and sends you a preview before anything is printed.' },
  { group: 'Custom orders', q: 'How does design approval work?', a: 'After you order, we prepare a design preview and send it to you by email and on your order page. Printing starts only after you approve it. If you want changes, you can request them with a short note.' },
  { group: 'Custom orders', q: 'How many changes can I ask for?', a: 'Each custom order includes 2 free revision rounds. If you need more after that, contact us and we will help.' },
  { group: 'Custom orders', q: 'How long does a custom piece take?', a: 'Most custom pieces take 5 to 10 working days after design approval, depending on size and complexity. This is an estimate, not a guaranteed delivery date.' },
  { group: 'Custom orders', q: 'What happens to the photos I share?', a: 'Your photos are stored privately and used only to make your order. They are never shown on public pages or in social previews, and are deleted 90 days after the order is completed, cancelled or expires.' },
  { group: 'Shipping and returns', q: 'Do you ship across India?', a: 'Yes. We deliver across India with tracked shipping and careful packaging. Once your order ships, you receive the courier name, tracking number and a tracking link, and you can follow progress on your order page or through your secure tracking link.' },
  { group: 'Shipping and returns', q: 'Is shipping free?', a: 'Shipping is free on orders above \u20B91,499. The checkout shows the exact total before you pay.' },
  { group: 'Shipping and returns', q: 'Can I cancel or return a custom item?', a: 'Custom items cannot be cancelled once production begins. If your order arrives damaged, report it within 24 to 48 hours with photos or an unboxing video. See our returns and refunds policy for details.' }
];

const Shell = ({ eyebrow = 'Information', title, children }) => (
  <div className="container page-shell static-page brand-page">
    <div className="page-header"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
    {children}
  </div>
);
const crumbs = (name, path) => breadcrumbLd([{ name: 'Home', path: '/' }, { name, path }]);

export function AboutPage() {
  useSeo({
    title: 'About Printxyz | Custom 3D Printed Gifts Made in India', path: '/about',
    description: 'Printxyz makes 3D-printed gifts, custom keepsakes and home decor to order and ships across India. Learn how we work and what to expect.',
    jsonLd: crumbs('About', '/about')
  });
  return (
    <Shell title="About Printxyz">
      <div className="content-card prose">
        <p><strong>Printxyz is an online store for 3D-printed gifts and custom keepsakes, shipped across India.</strong> We make devotional decor, toys, home decor, lithophanes, custom statues and name plates, each printed to order.</p>
        <h2>How we work</h2>
        <ul>
          <li><strong>Made to order.</strong> Pieces are printed after you order.</li>
          <li><strong>You approve custom designs.</strong> For personalised pieces we send a design preview first, and printing starts only after you approve it. Two free revision rounds are included.</li>
          <li><strong>Online payment only.</strong> We do not offer cash on delivery. Payments are verified securely before an order is confirmed.</li>
          <li><strong>Tracked delivery.</strong> You get the courier name, tracking number and tracking link once your order ships.</li>
          <li><strong>Private photos.</strong> Photos you share for custom work are never shown publicly and are deleted 90 days after the order finishes.</li>
        </ul>
        <h2>Looking for something specific?</h2>
        <p>Browse <Link to="/category/lithophanes">lithophanes</Link>, <Link to="/category/custom-statues">custom statues</Link>, <Link to="/category/devotional">devotional decor</Link> or <Link to="/category/name-plates">name plates</Link>. Questions before you order? Read the <Link to="/faq">FAQ</Link>, the <Link to="/size-guide">size guide</Link> and the <Link to="/care">care guide</Link>, or <Link to="/contact">contact us</Link>.</p>
      </div>
    </Shell>
  );
}

export function FaqPage() {
  useSeo({
    title: 'FAQ: Custom 3D Printed Gifts, Shipping and Payments | Printxyz', path: '/faq',
    description: 'Answers about ordering, custom design approval, production time, shipping across India, payments and returns at Printxyz.',
    jsonLd: [faqLd(FAQ_ITEMS), crumbs('FAQ', '/faq')]
  });
  const groups = [...new Set(FAQ_ITEMS.map((i) => i.group))];
  return (
    <Shell title="Frequently asked questions">
      {groups.map((g) => (
        <section key={g} className="faq-group">
          <h2>{g}</h2>
          {FAQ_ITEMS.filter((i) => i.group === g).map((i) => (
            <details key={i.q} className="faq-item"><summary>{i.q}</summary><p>{i.a}</p></details>
          ))}
        </section>
      ))}
      <p className="muted-note">Still have a question? <Link to="/contact">Contact us</Link>.</p>
    </Shell>
  );
}

export function SizeGuidePage() {
  useSeo({
    title: 'Size Guide for 3D Printed Statues, Lithophanes and Decor | Printxyz', path: '/size-guide',
    description: 'How Printxyz sizes are listed, how to choose the right size for a statue, lithophane or name plate, and what to do if you are unsure.',
    jsonLd: crumbs('Size guide', '/size-guide')
  });
  return (
    <Shell title="Size guide">
      <div className="content-card prose">
        <p>Each product page lists the exact sizes available and the price for each size. Sizes are given in centimetres.</p>
        <h2>How to read a size</h2>
        <p>Dimensions are written as height × width × depth where they apply, for example 8 × 10 × 6 cm. Flat pieces such as lithophanes and name plates list height and width, and the thickness is noted on the product page. Small variations are normal in 3D printing.</p>
        <h2>Choosing a size</h2>
        <div className="table-scroll">
          <table className="info-table">
            <thead><tr><th>Piece</th><th>What to think about</th></tr></thead>
            <tbody>
              <tr><td>Custom statues and miniatures</td><td>Larger sizes show more facial and fine detail. Choose the size based on where it will sit: desk, shelf or display cabinet.</td></tr>
              <tr><td>Lithophanes</td><td>Pick the size to suit the photo. Portraits and group photos look best at larger sizes where faces stay clear when lit.</td></tr>
              <tr><td>Name plates</td><td>Longer names need a wider plate to keep the letters readable. Check the plate width against your door or wall space.</td></tr>
              <tr><td>Devotional decor and home decor</td><td>Measure the shelf, mandir or table space first and compare it with the product dimensions.</td></tr>
            </tbody>
          </table>
        </div>
        <h2>Not sure?</h2>
        <p>Measure the space where the piece will go and compare it with the size listed on the product page. If you still cannot decide, <Link to="/contact">contact us</Link> before ordering and we will help you choose.</p>
      </div>
    </Shell>
  );
}

export function CarePage() {
  useSeo({
    title: 'Care Guide for 3D Printed Products | Printxyz', path: '/care',
    description: 'How to clean, display and look after 3D-printed statues, lithophanes, name plates and decor so they last.',
    jsonLd: crumbs('Care guide', '/care')
  });
  return (
    <Shell title="Care guide">
      <div className="content-card prose">
        <p>3D-printed pieces are made of plastic and last well with a little care. These tips apply to all Printxyz products.</p>
        <h2>Everyday care</h2>
        <ul>
          <li>Dust with a soft, dry cloth or brush. For marks, wipe gently with a slightly damp cloth and dry straight away.</li>
          <li>Avoid harsh chemicals, solvents and abrasive cleaners, which can dull or damage the finish.</li>
          <li>Handle fine details such as fingers, ears and thin edges gently, and lift statues by the base.</li>
        </ul>
        <h2>Heat and sunlight</h2>
        <ul>
          <li>Keep pieces away from strong heat, such as hot cars, ovens, heaters and long direct sunlight. Plastic can soften or warp when hot.</li>
          <li>Display near a window is fine, but avoid spots that get hours of direct sun.</li>
        </ul>
        <h2>Lithophanes and lamps</h2>
        <ul>
          <li>Lithophanes show their picture when lit from behind. Use a cool LED light source and do not use a hot bulb.</li>
          <li>Turn lights off when you leave a room for a long time.</li>
        </ul>
        <h2>If something arrives damaged</h2>
        <p>Report it within 24 to 48 hours of delivery with photos or an unboxing video. Read the <Link to="/policies/refund">returns and refunds policy</Link> or <Link to="/contact">contact us</Link>.</p>
      </div>
    </Shell>
  );
}
