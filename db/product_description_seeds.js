const tonerModels = [
    ['BROTHER TN-2480', 'TN-2480'], ['BROTHER TN-1000', 'TN-1000'],
    ['BROTHER TN-2380', 'TN-2380'], ['BROTHER TN-2560', 'TN-2560'],
    ...['BK', 'C', 'M', 'Y'].map(color => [`BROTHER TN-269 ${color}`, `TN-269 ${color}`]),
    ...['BK', 'C', 'M', 'Y'].map(color => [`BROTHER TN-261 ${color}`, `TN-261 ${color}`]),
    ['HP 107A W1107A', 'HP 107A W1107A'], ['HP 79A CF279A', 'HP 79A CF279A'],
    ['HP 85A CE285A', 'HP 85A CE285A'], ['HP 145A W1450A', 'HP 145A W1450A'],
    ['PANTUM TL-410X', 'PANTUM TL-410X'], ['SAMSUNG MLT-D116L', 'SAMSUNG MLT-D116L'],
    ['FUJI XEROX CT202877', 'FUJI XEROX CT202877'], ['CANON 325', 'CANON 325'],
    ...['BK', 'C', 'M', 'Y'].map(color => [`CANON 331 ${color}`, `CANON 331 ${color}`]),
    ['HP 30A CF230A', 'HP 30A CF230A'], ['HP 35A CB435A', 'HP 35A CB435A'],
    ['HP 230A', 'HP 230A'], ['HP 336A W1336A BK', 'HP 336A W1336A BK'],
    ['PANTUM PC-210EV', 'PANTUM PC-210EV'],
];
const powerStrips = [
    'รางปลั๊กไฟ 3 ช่อง ยาว 2 เมตร',
    'รางปลั๊กไฟ 4 ช่อง 4 สวิตช์ พร้อม USB ยาว 5 เมตร',
    'รางปลั๊กไฟ 4 ช่อง พร้อม USB 3 ช่อง ยาว 3 เมตร',
    'รางปลั๊กไฟ 4 ช่อง พร้อม USB 3 ช่อง และ USB-C 1 ช่อง ยาว 3 เมตร',
    'รางปลั๊กไฟ 4 ช่อง พร้อม USB 3 ช่อง และ USB-C 1 ช่อง ยาว 5 เมตร',
    'รางปลั๊กไฟ 5 ช่อง 5 สวิตช์ ยาว 3 เมตร',
    'รางปลั๊กไฟ 5 ช่อง 5 สวิตช์ ยาว 5 เมตร',
    'รางปลั๊กไฟ 5 ช่อง 5 สวิตช์ ยาว 10 เมตร',
    'รางปลั๊กไฟแบบล้อเก็บสาย 4 ช่อง ยาว 20 เมตร',
];
const batteries = [
    'ถ่านอัลคาไลน์ PANASONIC AA (4 ก้อน/แพ็ค)',
    'ถ่านอัลคาไลน์ PANASONIC AA (8 ก้อน/แพ็ค)',
    'ถ่านอัลคาไลน์ PANASONIC AAA (2 ก้อน/แพ็ค)',
    'ถ่านอัลคาไลน์ PANASONIC AAA (4 ก้อน/แพ็ค)',
    'ถ่านอัลคาไลน์ PANASONIC AAA (8 ก้อน/แพ็ค)',
    'ถ่านไฟฉาย PANASONIC NEO ขนาด C',
    'ถ่านชาร์จ PANASONIC eneloop AA (4 ก้อน/แพ็ค)',
    'ถ่านชาร์จ PANASONIC eneloop pro AA 2550 mAh (4 ก้อน/แพ็ค)',
    'ถ่านชาร์จ XTAR AA (4 ก้อน/แพ็ค)',
    'ถ่านกระดุม PANASONIC CR2032 (ถ่าน CMOS/BIOS)',
    'ถ่านกระดุม MAXELL CR2032 3V (ถ่าน CMOS/BIOS)',
    'ชุดเครื่องชาร์จ PANASONIC พร้อมถ่านชาร์จ AA 4 ก้อน',
    'ชุดเครื่องชาร์จเร็ว PANASONIC eneloop pro พร้อมถ่านชาร์จ AA 4 ก้อน',
];

export const productDescriptionSeeds = [
    ...tonerModels.flatMap(([original, compatible]) => [
        { description: `Toner Original ${original}`, category: 'หมึกพิมพ์' },
        { description: `ตลับหมึกเทียบ ${compatible}`, category: 'หมึกพิมพ์' },
    ]),
    ...powerStrips.map(description => ({ description, category: 'รางปลั๊กไฟ' })),
    ...batteries.map(description => ({ description, category: 'ถ่านและเครื่องชาร์จ' })),
];
