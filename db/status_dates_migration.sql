-- Migration: เพิ่มคอลัมน์เก็บวันที่เปลี่ยนสถานะแต่ละขั้น
-- สำหรับแสดงใน Tracking Stepper ของ Frontend

ALTER TABLE caseRepair
  ADD COLUMN statusDateWaiting DATETIME DEFAULT NULL COMMENT 'วันที่ตั้งสถานะ: รอรับเครื่อง',
  ADD COLUMN statusDateReceived DATETIME DEFAULT NULL COMMENT 'วันที่ตั้งสถานะ: รับเครื่องแล้ว',
  ADD COLUMN statusDateWaitPart DATETIME DEFAULT NULL COMMENT 'วันที่ตั้งสถานะ: รออะไหล่',
  ADD COLUMN statusDateRepairing DATETIME DEFAULT NULL COMMENT 'วันที่ตั้งสถานะ: กำลังซ่อม',
  ADD COLUMN statusDateComplete DATETIME DEFAULT NULL COMMENT 'วันที่ตั้งสถานะ: ซ่อมเสร็จ',
  ADD COLUMN statusDateDelivered DATETIME DEFAULT NULL COMMENT 'วันที่ตั้งสถานะ: ส่งมอบ';

-- Backfill: ใส่ค่าเริ่มต้นจาก created_at ให้เคสที่มีอยู่แล้ว
-- เคสที่สร้างแล้วอย่างน้อยต้องผ่านสถานะ "รับเครื่องแล้ว" มาแล้ว
UPDATE caseRepair SET statusDateReceived = created_at WHERE statusDateReceived IS NULL AND caseStatus IS NOT NULL;

-- เคสที่สถานะเป็น ซ่อมเสร็จ หรือ ส่งมอบ -> backfill จาก dateComplete/dateDelivered ถ้ามี
UPDATE caseRepair SET statusDateComplete = dateComplete WHERE statusDateComplete IS NULL AND dateComplete IS NOT NULL;
UPDATE caseRepair SET statusDateDelivered = dateDelivered WHERE statusDateDelivered IS NULL AND dateDelivered IS NOT NULL;
