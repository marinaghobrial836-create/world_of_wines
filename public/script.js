// Use the Google Sheets CSV export URL to keep the catalog synced automatically.
// To use the local CSV instead, replace this with '/api/products'.
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1X5rx_VAk6gvjNX2UHFZKFe-v_SexMadiAtc3THe_jns/export?format=csv&gid=0';
let products = [];
let sheetError = '';

const $ = (id) => document.getElementById(id);
const money = (value) => `$${value.toFixed(2)}`;
const productById = (id) => products.find((product) => product.id === id);

const productDisplayName = (product) => {
  const name = String(product.name || '').trim();
  const brand = String(product.brand || '').trim();

  if (!name && !brand) return 'Unnamed product';
  if (name.toLowerCase() === brand.toLowerCase()) return brand || name;
  return `${brand} ${name}`.trim();
};

function loadCart() {
  try {
    const stored = JSON.parse(localStorage.getItem('worldOfWineCart') || '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((item) => productById(Number(item.id)) && Number.isInteger(Number(item.qty)) && Number(item.qty) > 0)
      .map((item) => ({ id: Number(item.id), qty: Number(item.qty) }));
  } catch {
    localStorage.removeItem('worldOfWineCart');
    return [];
  }
}

let cart = loadCart();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function saveCart() {
  localStorage.setItem('worldOfWineCart', JSON.stringify(cart));
  renderCart();
  updateCartCount();
}

function updateCartCount() {
  const count = cart.reduce((total, item) => total + item.qty, 0);
  $('cartCount').textContent = String(count);
}

function renderBrands() {
  renderFilterOptions('brandFilter', 'All brands', products.map((product) => product.brand));
  renderFilterOptions('typeFilter', 'All types', products.map((product) => product.type));
  renderFilterOptions('categoryFilter', 'All categories', products.map((product) => product.category));
}

function renderFilterOptions(id, allLabel, values) {
  const select = $(id);
  const currentValue = select.value;
  const options = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="All">${allLabel}</option>${options
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('')}`;
  select.value = options.includes(currentValue) ? currentValue : 'All';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }

  return rows;
}

function headerKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parsePrice(value) {
  const parsed = Number.parseFloat(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInventory(value) {
  const parsed = Number.parseInt(String(value).replace(/[, ]/g, ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function loadProducts() {
  try {
    const sheetUrl = new URL(SHEET_CSV_URL, window.location.href);
    sheetUrl.searchParams.set('cachebust', Date.now());
    const response = await fetch(sheetUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);

    const rows = parseCsv(await response.text());
    if (rows.length < 2) throw new Error('The sheet has no product rows.');

    const headers = rows[0].map(headerKey);
    const column = (names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);

    const categoryIndex = column(['category']);
    const typeIndex = column(['type']);
    const brandIndex = column(['brand', 'nameofbrand']);
    const nameIndex = column(['product', 'name']);
    const inventoryIndex = column(['inventory', 'quantity', 'stock']);
    const priceIndex = column(['price', 'websiteprice']);
    const sizeIndex = column(['size']);
    const imageIndex = column(['image', 'photo', 'imageurl', 'picture']);

    if ([brandIndex, nameIndex, priceIndex].some((index) => index === undefined)) {
      throw new Error('Add Category, Type, Brand, Product, Inventory, Price and Size headers to row 1.');
    }

    products = rows
      .slice(1)
      .map((row, rowIndex) => {
        const price = parsePrice(row[priceIndex]);
        if (!row[brandIndex] && !row[nameIndex] && price === null) return null;

        return {
          id: rowIndex + 1,
          category: row[categoryIndex] || 'Other',
          type: row[typeIndex] || '',
          brand: row[brandIndex] || 'Unbranded',
          name: row[nameIndex] || row[brandIndex] || 'Unnamed product',
          inventory: parseInventory(row[inventoryIndex]),
          price: price ?? 0,
          size: row[sizeIndex] || '',
          image: row[imageIndex] || '',
        };
      })
      .filter(Boolean);

    if (!products.length) throw new Error('No valid products were found in the sheet.');

    sheetError = '';
    $('sheetStatus').hidden = true;
    renderBrands();
    cart = loadCart();
    renderProducts();
    renderCart();
    updateCartCount();
  } catch (error) {
    products = [];
    sheetError = error.message;
    $('sheetStatus').textContent = 'We could not load the current inventory. Please try again shortly.';
    $('sheetStatus').hidden = false;
    renderProducts();
    renderCart();
    updateCartCount();
  }
}

function getFilteredProducts() {
  const category = $('categoryFilter').value;
  const type = $('typeFilter').value;
  const brand = $('brandFilter').value;
  const search = $('searchInput').value.trim().toLowerCase();
  const min = Number.parseFloat($('minPrice').value);
  const max = Number.parseFloat($('maxPrice').value);
  const sort = $('sortFilter').value;
  const inStockOnly = $('inStockFilter').checked;
  const invalidRange = !Number.isNaN(min) && !Number.isNaN(max) && min > max;

  $('filterError').hidden = !invalidRange;
  if (invalidRange) return [];

  const list = products.filter(
    (product) =>
      (category === 'All' || product.category === category) &&
      (type === 'All' || product.type === type) &&
      (brand === 'All' || product.brand === brand) &&
      (!search || `${product.name} ${product.brand} ${product.type} ${product.category}`.toLowerCase().includes(search)) &&
      (Number.isNaN(min) || product.price >= min) &&
      (Number.isNaN(max) || product.price <= max) &&
      (!inStockOnly || product.inventory > 0),
  );

  if (sort === 'price-low') list.sort((a, b) => a.price - b.price);
  if (sort === 'price-high') list.sort((a, b) => b.price - a.price);
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));

  return list;
}

function bottleClass(category) {
  return `bottle bottle--${String(category || 'wine').toLowerCase()}`;
}

function productImageUrl(product) {
  const category = String(product.category || '').toLowerCase();
  const fallbackByCategory = {
    wine: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=900&q=80',
    whiskey: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=900&q=80',
    tequila: 'https://images.unsplash.com/photo-1560508180-4d5f3b6d9b9d?auto=format&fit=crop&w=900&q=80',
    rum: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80',
    beer: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?auto=format&fit=crop&w=900&q=80',
  };

  return product.image || fallbackByCategory[category] || fallbackByCategory.wine;
}

function renderProducts() {
  const list = getFilteredProducts();

  if (sheetError) {
    $('resultsCount').textContent = 'Inventory unavailable';
    $('emptyState').hidden = false;
    $('emptyState').querySelector('h3').textContent = 'Inventory is temporarily unavailable';
    $('emptyState').querySelector('p').textContent = 'Please try again later or contact the store.';
    $('productGrid').innerHTML = '';
    return;
  }

  $('resultsCount').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
  $('emptyState').hidden = list.length > 0;
  $('productGrid').innerHTML = list
    .map(
      (product) => `
        <article class="product-card">
          <div class="product-image">
            ${product.image || productImageUrl(product)
              ? `<img src="${escapeHtml(product.image || productImageUrl(product))}" alt="${escapeHtml(productDisplayName(product))}" loading="lazy" />`
              : `<div class="${bottleClass(product.category)}" aria-hidden="true"><span>${escapeHtml(product.category)}</span></div>`}
          </div>
          <div class="product-body">
            <span class="product-category">${escapeHtml(product.category)}${product.type ? ` · ${escapeHtml(product.type)}` : ''}</span>
            <h3 class="product-name">${escapeHtml(productDisplayName(product))}</h3>
            <div class="product-brand">${escapeHtml(product.type || product.brand)}${product.size ? ` · ${escapeHtml(product.size)}` : ''}</div>
            <div class="product-bottom">
              <span class="price">${money(product.price)}</span>
              <span class="stock-status stock-status--${product.inventory === 0 ? 'out' : product.inventory < 10 ? 'low' : 'in'}">
                ${product.inventory === 0 ? 'Out of stock' : product.inventory < 10 ? `${product.inventory} left` : 'In stock'}
              </span>
              <button class="add-button" type="button" data-add="${product.id}" ${product.inventory === 0 ? 'disabled' : ''}>
                ${product.inventory === 0 ? 'Out of stock' : 'Add to cart'}
              </button>
            </div>
          </div>
        </article>
      `,
    )
    .join('');
}

function cartSubtotal() {
  return cart.reduce((total, item) => {
    const product = productById(item.id);
    return total + (product ? product.price * item.qty : 0);
  }, 0);
}

function renderCart() {
  if (!cart.length) {
    $('cartItems').innerHTML = '<div class="empty-state"><h3>Your cart is empty</h3><p>Add a bottle to get started.</p></div>';
  } else {
    $('cartItems').innerHTML = cart
      .map((item) => {
        const product = productById(item.id);
        if (!product) return '';

        return `
          <div class="cart-item">
            <div>
              <strong>${escapeHtml(productDisplayName(product))}</strong>
              <div class="cart-item-meta">${escapeHtml(product.type || product.brand)} · ${money(product.price)} each</div>
              <div class="quantity" aria-label="Quantity for ${escapeHtml(productDisplayName(product))}">
                <button type="button" data-quantity="${product.id}" data-delta="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
                <strong>${item.qty}</strong>
                <button type="button" data-quantity="${product.id}" data-delta="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>
              </div>
            </div>
            <strong>${money(product.price * item.qty)}</strong>
          </div>
        `;
      })
      .join('');
  }

  $('cartSubtotal').textContent = money(cartSubtotal());
  $('checkoutButton').disabled = cart.length === 0;
}

function addToCart(id) {
  const product = productById(id);
  if (!product || product.inventory < 1) {
    announce('That product is out of stock');
    return;
  }

  const item = cart.find((entry) => entry.id === id);
  if (item) {
    if (item.qty >= product.inventory) {
      announce(`Only ${product.inventory} available`);
      return;
    }
    item.qty += 1;
  } else {
    cart.push({ id, qty: 1 });
  }

  saveCart();
  announce('Added to cart');
  openCart();
}

function changeQuantity(id, delta) {
  const item = cart.find((entry) => entry.id === id);
  if (!item) return;

  const product = productById(id);
  item.qty = Math.min(product?.inventory ?? 0, item.qty + delta);

  if (item.qty <= 0) cart = cart.filter((entry) => entry.id !== id);
  saveCart();
}

function announce(message) {
  $('statusMessage').textContent = message;
}

function setScrollLock(locked) {
  document.body.classList.toggle('no-scroll', locked);
}

function openCart() {
  $('cartDrawer').classList.add('open');
  $('cartDrawer').setAttribute('aria-hidden', 'false');
  $('drawerBackdrop').hidden = false;
  setScrollLock(true);
  $('closeCart').focus();
}

function closeCart() {
  $('cartDrawer').classList.remove('open');
  $('cartDrawer').setAttribute('aria-hidden', 'true');
  $('drawerBackdrop').hidden = true;
  if ($('checkoutModal').hidden) setScrollLock(false);
}

function openCheckout() {
  if (!cart.length) return;
  closeCart();
  $('checkoutFormView').hidden = false;
  $('thankYouView').hidden = true;
  $('checkoutModal').hidden = false;
  setScrollLock(true);
  $('checkoutModal').querySelector('input').focus();
}

function closeCheckout() {
  $('checkoutModal').hidden = true;
  setScrollLock(false);
}

function clearFilters() {
  $('categoryFilter').value = 'All';
  $('typeFilter').value = 'All';
  $('brandFilter').value = 'All';
  $('minPrice').value = '';
  $('maxPrice').value = '';
  $('searchInput').value = '';
  $('sortFilter').value = 'featured';
  $('inStockFilter').checked = false;
  renderProducts();
  announce('Filters cleared');
}

function applyFilters() {
  renderProducts();
  announce('Filters applied');
  $('resultsCount').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('filterForm').addEventListener('submit', (event) => {
  event.preventDefault();
  applyFilters();
});

$('applyFilters').addEventListener('click', applyFilters);

$('productGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]');
  if (button) addToCart(Number(button.dataset.add));
});

$('cartItems').addEventListener('click', (event) => {
  const button = event.target.closest('[data-quantity]');
  if (button) changeQuantity(Number(button.dataset.quantity), Number(button.dataset.delta));
});

$('clearFilters').addEventListener('click', clearFilters);
$('cartButton').addEventListener('click', openCart);
$('closeCart').addEventListener('click', closeCart);
$('drawerBackdrop').addEventListener('click', closeCart);
$('checkoutButton').addEventListener('click', openCheckout);
$('closeCheckout').addEventListener('click', closeCheckout);
$('continueShopping').addEventListener('click', closeCheckout);

$('checkoutForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const submitButton = $('checkoutForm').querySelector('button[type="submit"]');
  const formData = new FormData(event.currentTarget);
  const orderId = `WOW-${Math.floor(100000 + Math.random() * 900000)}`;
  const order = {
    orderId,
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    fulfillment: formData.get('fulfillment'),
    address: formData.get('address'),
    city: formData.get('city'),
    zip: formData.get('zip'),
    subtotal: cartSubtotal(),
    items: cart.map((item) => {
      const product = productById(item.id);
      return {
        name: productDisplayName(product),
        quantity: item.qty,
        unitPrice: product.price,
        lineTotal: product.price * item.qty,
      };
    }),
  };

  submitButton.disabled = true;
  submitButton.textContent = 'Sending confirmation...';
  $('checkoutError').hidden = true;
  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  })
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to place order');
      return result;
    })
    .then(() => {
      $('orderNumber').textContent = `Order number: ${orderId}`;
      $('checkoutForm').reset();
      $('checkoutFormView').hidden = true;
      $('thankYouView').hidden = false;
      cart = [];
      saveCart();
      $('continueShopping').focus();
    })
    .catch((error) => {
      $('checkoutError').textContent = error.message;
      $('checkoutError').hidden = false;
      announce(error.message);
    })
    .finally(() => {
      submitButton.disabled = false;
      submitButton.textContent = 'Place order';
    });
});

document.querySelectorAll('[data-category-link]').forEach((link) => {
  link.addEventListener('click', () => {
    $('categoryFilter').value = link.dataset.categoryLink;
    renderProducts();
  });
});

const dropdown = document.querySelector('.dropdown');
const dropdownButton = document.querySelector('.dropdown__button');

dropdownButton.addEventListener('click', () => {
  const expanded = dropdownButton.getAttribute('aria-expanded') === 'true';
  dropdownButton.setAttribute('aria-expanded', String(!expanded));
  dropdown.classList.toggle('is-open', !expanded);
});

document.addEventListener('click', (event) => {
  if (!dropdown.contains(event.target)) {
    dropdown.classList.remove('is-open');
    dropdownButton.setAttribute('aria-expanded', 'false');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('checkoutModal').hidden) closeCheckout();
  else if ($('cartDrawer').classList.contains('open')) closeCart();
  else if (dropdown.classList.contains('is-open')) {
    dropdown.classList.remove('is-open');
    dropdownButton.setAttribute('aria-expanded', 'false');
  }
});

$('year').textContent = String(new Date().getFullYear());
loadProducts();
renderCart();
updateCartCount();
