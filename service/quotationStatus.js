const documentStages = {
    QUOTATION: 1,
    ORDERING: 1,
    ITEMS_READY: 1,
    DELIVERY_NOTE: 2,
    RECEIPT: 3,
};

// A stale form must never silently undo an issued delivery note or receipt.
export function getQuotationStatusConflict(existingDoc, data) {
    const currentStatus = existingDoc.current_status;
    if (data.expected_current_status !== undefined && data.expected_current_status !== currentStatus) {
        return {
            code: 'QUOTATION_STATUS_CONFLICT',
            message: 'สถานะเอกสารเปลี่ยนไปแล้ว กรุณาโหลดเอกสารล่าสุดก่อนบันทึกอีกครั้ง',
            current_status: currentStatus,
        };
    }

    const nextStatus = data.current_status ?? currentStatus;
    const isRollback = documentStages[currentStatus] >= 2
        && documentStages[nextStatus] < documentStages[currentStatus];
    const rollbackConfirmed = data.confirm_status_rollback === true
        && data.expected_current_status === currentStatus;

    if (isRollback && !rollbackConfirmed) {
        return {
            code: 'QUOTATION_STATUS_ROLLBACK_REQUIRED',
            message: 'เอกสารออกใบส่งของหรือใบเสร็จแล้ว กรุณาโหลดข้อมูลล่าสุดและยืนยันการเปลี่ยนสถานะก่อนบันทึก',
            current_status: currentStatus,
        };
    }
    return null;
}
