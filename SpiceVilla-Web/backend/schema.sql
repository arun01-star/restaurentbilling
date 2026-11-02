CREATE DATABASE IF NOT EXISTS spicevilla
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;
USE spicevilla;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL,
    name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('owner', 'customer') NOT NULL DEFAULT 'customer',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    phone VARCHAR(32) NULL,
    address TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_user (user_id),
    CONSTRAINT fk_customers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sessions_token_hash (token_hash),
    KEY ix_sessions_user_expiry (user_id, expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS food_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL,
    slug VARCHAR(90) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_food_categories_name (name),
    UNIQUE KEY uq_food_categories_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS food_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    image_url VARCHAR(500) NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_food_items_category_available (category_id, is_available),
    CONSTRAINT fk_food_items_category FOREIGN KEY (category_id) REFERENCES food_categories(id) ON DELETE RESTRICT,
    CONSTRAINT chk_food_items_price CHECK (price >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_number VARCHAR(36) NOT NULL,
    idempotency_key VARCHAR(64) NULL,
    user_id BIGINT UNSIGNED NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(254) NULL,
    customer_phone VARCHAR(32) NULL,
    order_type ENUM('Dine-in', 'Takeaway', 'Delivery') NOT NULL,
    table_label VARCHAR(40) NULL,
    status ENUM('New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled') NOT NULL DEFAULT 'New',
    payment_method ENUM('Cash', 'UPI', 'Card', 'Online Payment', 'Pay at restaurant') NOT NULL DEFAULT 'Pay at restaurant',
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    cgst DECIMAL(10,2) NOT NULL DEFAULT 0,
    sgst DECIMAL(10,2) NOT NULL DEFAULT 0,
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_orders_number (order_number),
    UNIQUE KEY uq_orders_idempotency (idempotency_key),
    KEY ix_orders_user_created (user_id, created_at),
    KEY ix_orders_status_created (status, created_at),
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_orders_amounts CHECK (subtotal >= 0 AND discount_amount >= 0 AND total >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    food_id BIGINT UNSIGNED NULL,
    food_name VARCHAR(120) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (id),
    KEY ix_order_items_order (order_id),
    KEY ix_order_items_food (food_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_food FOREIGN KEY (food_id) REFERENCES food_items(id) ON DELETE SET NULL,
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_order_items_prices CHECK (unit_price >= 0 AND line_total >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bills (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_number VARCHAR(40) NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    cgst_rate DECIMAL(5,2) NOT NULL DEFAULT 2.50,
    sgst_rate DECIMAL(5,2) NOT NULL DEFAULT 2.50,
    cgst DECIMAL(10,2) NOT NULL,
    sgst DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bills_invoice_number (invoice_number),
    UNIQUE KEY uq_bills_order (order_id),
    CONSTRAINT fk_bills_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    bill_id BIGINT UNSIGNED NOT NULL,
    method ENUM('Cash', 'UPI', 'Card', 'Online Payment') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    transaction_reference VARCHAR(100) NULL,
    paid_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_payments_bill_created (bill_id, created_at),
    KEY ix_payments_status_created (status, created_at),
    CONSTRAINT fk_payments_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
    CONSTRAINT chk_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_name VARCHAR(120) NOT NULL,
    customer_phone VARCHAR(32) NOT NULL,
    guest_count TINYINT UNSIGNED NOT NULL,
    reservation_at DATETIME NOT NULL,
    notes TEXT NULL,
    status ENUM('requested', 'confirmed', 'cancelled') NOT NULL DEFAULT 'requested',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_reservations_datetime (reservation_at, status),
    CONSTRAINT chk_reservations_guests CHECK (guest_count BETWEEN 1 AND 20)
) ENGINE=InnoDB;

INSERT INTO food_categories (name, slug) VALUES
    ('Starters', 'starters'),
    ('Main Course', 'main-course'),
    ('Rice & Biryani', 'rice-biryani'),
    ('Breads', 'breads'),
    ('Beverages', 'beverages'),
    ('Desserts', 'desserts')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO food_items (category_id, name, description, price, image_url, is_available)
SELECT c.id, seed.name, seed.description, seed.price, seed.image_url, TRUE
FROM (
    SELECT 'Starters' AS category_name, 'Paneer Tikka' AS name, 'Tandoor-charred cottage cheese with peppers and onions.' AS description, 210.00 AS price, 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=700&q=80' AS image_url
    UNION ALL SELECT 'Starters', 'Hara Bhara Kebab', 'Spinach, peas and aromatic herbs, crisp outside and tender inside.', 180.00, 'https://images.unsplash.com/photo-1601050690117-94f5f6fa8bd7?auto=format&fit=crop&w=700&q=80'
    UNION ALL SELECT 'Main Course', 'Shahi Paneer', 'Cottage cheese in a rich, gently spiced royal gravy.', 260.00, 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=700&q=80'
    UNION ALL SELECT 'Main Course', 'Dal Makhani', 'Slow-cooked black lentils finished with butter and cream.', 230.00, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=700&q=80'
    UNION ALL SELECT 'Rice & Biryani', 'Vegetable Biryani', 'Fragrant basmati rice layered with garden vegetables and spices.', 240.00, 'https://images.unsplash.com/photo-1563379091339-03246963d51a?auto=format&fit=crop&w=700&q=80'
    UNION ALL SELECT 'Breads', 'Garlic Naan', 'Tandoor-baked naan brushed with garlic and butter.', 75.00, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'
    UNION ALL SELECT 'Beverages', 'Mango Lassi', 'Creamy yoghurt drink blended with ripe Alphonso mango.', 120.00, 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=700&q=80'
    UNION ALL SELECT 'Desserts', 'Gulab Jamun', 'Soft milk dumplings soaked in warm cardamom syrup.', 110.00, 'https://images.unsplash.com/photo-1666190094762-9b6d6f3e7a34?auto=format&fit=crop&w=700&q=80'
) AS seed
JOIN food_categories c ON c.name = seed.category_name
LEFT JOIN food_items existing ON existing.name = seed.name
WHERE existing.id IS NULL;
