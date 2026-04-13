-- =============================================
-- Migration: สร้างตาราง customers (Customer Master Data)
-- =============================================

CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL COMMENT 'ชื่อลูกค้า/บริษัท',
    customer_tax_id VARCHAR(20) DEFAULT NULL COMMENT 'เลขประจำตัวผู้เสียภาษี 13 หลัก',
    customer_phone VARCHAR(20) DEFAULT NULL COMMENT 'เบอร์โทรศัพท์',
    customer_address TEXT DEFAULT NULL COMMENT 'ที่อยู่',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index สำหรับการค้นหา
CREATE INDEX idx_customers_name ON customers(customer_name);

-- =============================================
-- (Optional) Migrate ข้อมูลลูกค้าเก่าจากตาราง documents
-- =============================================
-- INSERT IGNORE INTO customers (customer_name, customer_tax_id, customer_phone, customer_address)
-- SELECT DISTINCT
--     TRIM(d.customer_name),
--     d.customer_tax_id,
--     d.customer_phone,
--     d.customer_address
-- FROM documents d
-- WHERE d.customer_name IS NOT NULL
--   AND TRIM(d.customer_name) <> '';
