export const categories = [
  { id: 'devotional', name: 'Devotional', slug: 'devotional', icon: '🪔' },
  { id: 'toys', name: 'Toys', slug: 'toys', icon: '🧸' },
  { id: 'home-decor', name: 'Home Decor', slug: 'home-decor', icon: '🏠' },
  { id: 'lithophanes', name: 'Lithophanes', slug: 'lithophanes', icon: '💡' },
  { id: 'custom-statues', name: 'Custom Statues', slug: 'custom-statues', icon: '🗿' },
  { id: 'name-plates', name: 'Name Plates', slug: 'name-plates', icon: '🪧' }
];

export const banners = [
  {
    id: 'b1',
    title: 'Custom 3D gifts for every celebration',
    subtitle: 'Made to order in India with premium finish and fast delivery.',
    buttonText: 'Shop bestsellers',
    link: '/search?q=3d%20gift',
    imageDesktop: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1200&q=80',
    imageMobile: 'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'b2',
    title: 'Name plates & decor with a personal touch',
    subtitle: 'Custom sizes, colors, and meaningful gifting options.',
    buttonText: 'Explore custom pieces',
    link: '/category/custom-statues',
    imageDesktop: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
    imageMobile: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'b3',
    title: 'Photo-lit keepsakes for your home',
    subtitle: 'Personalized gifts that turn memories into art.',
    buttonText: 'See gallery',
    link: '/gallery',
    imageDesktop: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=80',
    imageMobile: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80'
  }
];

export const sections = [
  { id: 'trending', title: 'Trending', slug: 'trending' },
  { id: 'most-loved', title: 'Most Loved', slug: 'most-loved' },
  { id: 'popular', title: 'Popular', slug: 'popular' },
  { id: 'bestsellers', title: 'Bestsellers', slug: 'bestsellers' },
  { id: 'new-arrivals', title: 'New Arrivals', slug: 'new-arrivals' }
];

export const products = [
  {
    id: 'p1',
    slug: 'ganesha-lamp',
    title: 'Ganesha 3D Lamp',
    category: 'Devotional',
    categorySlug: 'devotional',
    price: 1799,
    mrp: 2499,
    rating: 0,
    reviews: 0,
    stock: 22,
    tags: ['devotional', 'lamp'],
    image: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Hand-finished devotional lamp with an elegant warm glow and smooth finish.',
    badges: ['Bestseller', 'Custom'],
    featured: true,
    section: 'bestsellers'
  },
  {
    id: 'p2',
    slug: 'peacock-name-plate',
    title: 'Peacock Name Plate',
    category: 'Name Plates',
    categorySlug: 'name-plates',
    price: 1299,
    mrp: 1899,
    rating: 0,
    reviews: 0,
    stock: 16,
    tags: ['name plate', 'home decor'],
    image: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Sleek front-door plate in 3D printed design with custom text engraving.',
    badges: ['New'],
    featured: true,
    section: 'new-arrivals'
  },
  {
    id: 'p3',
    slug: 'miniature-pet-statue',
    title: 'Miniature Pet Statue',
    category: 'Custom Statues',
    categorySlug: 'custom-statues',
    price: 2199,
    mrp: 2999,
    rating: 0,
    reviews: 0,
    stock: 9,
    tags: ['custom statue', 'pet'],
    image: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1551881191-2cc0d8bf7df0?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Customisable pet portrait statue with smooth finish and premium base.',
    badges: ['Custom', 'Best Seller'],
    featured: true,
    section: 'most-loved'
  },
  {
    id: 'p4',
    slug: 'family-portrait-lithophane',
    title: 'Family Portrait Lithophane',
    category: 'Lithophanes',
    categorySlug: 'lithophanes',
    price: 2499,
    mrp: 2999,
    rating: 0,
    reviews: 0,
    stock: 12,
    tags: ['lithophane', 'custom photo'],
    image: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'A glowing personalised lithophane that brings your family photo to life.',
    badges: ['Custom'],
    featured: true,
    section: 'trending'
  },
  {
    id: 'p5',
    slug: 'dragon-toy-set',
    title: 'Dragon Toy Set',
    category: 'Toys',
    categorySlug: 'toys',
    price: 899,
    mrp: 1399,
    rating: 0,
    reviews: 0,
    stock: 31,
    tags: ['toy', 'kids'],
    image: 'https://images.unsplash.com/photo-1555547666-3d16f0d5f7a0?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1555547666-3d16f0d5f7a0?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Durable 3D printed creature set with smooth detailing and bright color finish.',
    badges: ['New'],
    featured: false,
    section: 'popular'
  },
  {
    id: 'p6',
    slug: 'plant-stand',
    title: 'Modern Plant Stand',
    category: 'Home Decor',
    categorySlug: 'home-decor',
    price: 1499,
    mrp: 1999,
    rating: 0,
    reviews: 0,
    stock: 18,
    tags: ['decor', 'plant'],
    image: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Minimal geometric plant stand for modern homes and gifting.',
    badges: ['Popular'],
    featured: false,
    section: 'popular'
  },
  {
    id: 'p7',
    slug: 'lotus-table-ornament',
    title: 'Lotus Table Ornament',
    category: 'Devotional',
    categorySlug: 'devotional',
    price: 999,
    mrp: 1499,
    rating: 0,
    reviews: 0,
    stock: 27,
    tags: ['lotus', 'mandir'],
    image: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Elegant devotional ornament designed for prayer corners and desks.',
    badges: ['Verified'],
    featured: false,
    section: 'trending'
  },
  {
    id: 'p8',
    slug: 'custom-3d-couple-statue',
    title: 'Couple 3D Statue',
    category: 'Custom Statues',
    categorySlug: 'custom-statues',
    price: 2899,
    mrp: 3499,
    rating: 0,
    reviews: 0,
    stock: 6,
    tags: ['statue', 'custom gift'],
    image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'Create a custom 3D statue from your favourite photo as a heartfelt keepsake.',
    badges: ['Custom'],
    featured: false,
    section: 'most-loved'
  },
  {
    id: 'p9',
    slug: 'story-book-name-plate',
    title: 'Story Book Name Plate',
    category: 'Name Plates',
    categorySlug: 'name-plates',
    price: 1199,
    mrp: 1699,
    rating: 0,
    reviews: 0,
    stock: 14,
    tags: ['name plate', 'kids'],
    image: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'A charming name plate designed to suit bedrooms, study corners and kids rooms.',
    badges: ['New'],
    featured: false,
    section: 'new-arrivals'
  },
  {
    id: 'p10',
    slug: 'pet-lithophane-night-light',
    title: 'Pet Lithophane Night Light',
    category: 'Lithophanes',
    categorySlug: 'lithophanes',
    price: 2399,
    mrp: 2899,
    rating: 0,
    reviews: 0,
    stock: 11,
    tags: ['lithophane', 'pet'],
    image: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80',
    images: [
      'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=800&q=80'
    ],
    description: 'A warm lit custom keepsake for pets and people who keep memories close.',
    badges: ['Custom'],
    featured: false,
    section: 'bestsellers'
  }
];

export const galleryItems = [
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1551881191-2cc0d8bf7df0?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=900&q=80'
];

export const blogPosts = [
  { title: '3D Printed Gifts That Feel Personal', excerpt: 'How custom-made decor adds meaning to gifting moments.', slug: '3d-printed-gifts-that-feel-personal' },
  { title: 'Choosing the Right Custom Photo Gift', excerpt: 'A quick guide to size, finish, and placement for memorable keepsakes.', slug: 'choosing-the-right-custom-photo-gift' },
  { title: 'Decor ideas for modern homes', excerpt: 'A few easy ways to make small spaces stand out with meaningful accents.', slug: 'decor-ideas-for-modern-homes' }
];
