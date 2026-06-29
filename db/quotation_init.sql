-- สร้างตารางหลัก documents
CREATE TABLE IF NOT EXISTS documents (
    -- ID เป็น String กำหนดเอง เช่น 'QT-2026-001'
    id VARCHAR(50) PRIMARY KEY,
    
    -- เลขที่ใบเสนอราคา (แยกเก็บตาม requirement)
    quotation_id VARCHAR(50),
    
    -- Status Tracking
    current_status ENUM('QUOTATION', 'DELIVERY_NOTE', 'RECEIPT', 'CANCELLED') DEFAULT 'QUOTATION',
    
    -- === ข้อมูลลูกค้า (Customer Info) ===
    customer_name VARCHAR(255),
    customer_tax_id VARCHAR(20),
    customer_phone VARCHAR(20),
    customer_address TEXT,
    
    -- === ข้อมูลทั่วไป (Common Info) ===
    salesman VARCHAR(100),
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- === 1. QUOTATION (ใบเสนอราคา) ===
    -- วันที่ออกใบเสนอราคา
    issue_date_str VARCHAR(20), -- เก็บ '13/02/2569' ไว้โชว์
    issue_date DATE,            -- เก็บ '2026-02-13' ไว้ Sort/Filter
    
    price_validity_days INT,
    
    -- วันยืนยันราคาถึง
    valid_until_str VARCHAR(20),
    valid_until DATE,
    
    offerer_name VARCHAR(100), -- ชื่อผู้เสนอราคา

    -- === 2. DELIVERY NOTE (ใบส่งของ) ===
    delivery_note_no VARCHAR(50), -- เช่น 'DN-2026-001'
    
    -- วันที่ส่งของ (Document Date)
    delivery_date_str VARCHAR(20),
    delivery_date DATE,
    
    payment_term VARCHAR(50), -- เครดิต (เช่น 30 วัน)
    
    -- วันครบกำหนดชำระ
    due_date_str VARCHAR(20),
    due_date DATE,
    
    delivery_address TEXT, -- สถานที่จัดส่ง (ถ้าต่างจากที่อยู่ลูกค้า)

    -- Signatures (ลงนามใบส่งของ)
    receiver_name VARCHAR(100), -- ผู้รับของ
    received_date_str VARCHAR(20), -- วันที่รับของ
    received_date DATE,
    
    sender_name VARCHAR(100),   -- ผู้ส่งของ
    sent_date_str VARCHAR(20),  -- วันที่ส่งของ
    sent_date DATE,
    
    delivery_authorized_signer VARCHAR(100), -- ผู้มีอำนาจลงนาม

    -- === 3. RECEIPT (ใบเสร็จรับเงิน) ===
    receipt_no VARCHAR(50), -- เช่น 'RC-2026-001'
    
    -- วันที่ออกใบเสร็จ
    receipt_issue_date_str VARCHAR(20),
    receipt_issue_date DATE,
    
    -- Payment Info
    payment_method VARCHAR(50), -- 'เงินสด', 'เช็คธนาคาร', 'โอนเงิน'
    cheque_bank VARCHAR(100),
    cheque_branch VARCHAR(100),
    cheque_no VARCHAR(50),
    cheque_amount DECIMAL(15, 2),
    
    -- วันที่เช็ค
    cheque_date_str VARCHAR(20),
    cheque_date DATE,
    
    -- Signatures (ลงนามใบเสร็จ)
    -- วันที่ได้รับสินค้าถูกต้องตามรายการ
    goods_received_check_date_str VARCHAR(20),
    goods_received_check_date DATE,
    
    money_receiver_name VARCHAR(100), -- ผู้รับเงิน
    
    -- วันที่รับเงิน
    money_receive_date_str VARCHAR(20),
    money_receive_date DATE,
    
    receipt_authorized_signer VARCHAR(100) -- ผู้มีอำนาจลงนาม
);

-- สร้างตารางกลุ่มสินค้า (Sections)
CREATE TABLE IF NOT EXISTS document_sections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id VARCHAR(50) NOT NULL, -- FK เชื่อมไปที่ documents.id
    section_name VARCHAR(255) NOT NULL, -- ชื่อกลุ่ม เช่น "งานติดตั้ง", "อุปกรณ์"
    sort_order INT DEFAULT 0, -- เอาไว้เรียงลำดับกลุ่ม 1, 2, 3
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- สร้างตารางรายการสินค้า (Items)
CREATE TABLE IF NOT EXISTS document_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section_id INT NOT NULL, -- FK เชื่อมไปที่ document_sections.id
    description TEXT, -- รายละเอียดสินค้า
    quantity DECIMAL(10, 2) DEFAULT 1, -- จำนวน
    unit VARCHAR(50), -- หน่วยนับ
    unit_price DECIMAL(15, 2) DEFAULT 0, -- ราคาต่อหน่วย
    total_amount DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED, -- คำนวณยอดรวมให้อัตโนมัติ
    sort_order INT DEFAULT 0, -- เอาไว้เรียงลำดับรายการในกลุ่ม
    FOREIGN KEY (section_id) REFERENCES document_sections(id) ON DELETE CASCADE
);

-- Index สำหรับการค้นหาที่รวดเร็ว
CREATE INDEX IF NOT EXISTS idx_current_status ON documents(current_status);
CREATE INDEX IF NOT EXISTS idx_issue_date ON documents(issue_date);
CREATE INDEX IF NOT EXISTS idx_customer_name ON documents(customer_name);
