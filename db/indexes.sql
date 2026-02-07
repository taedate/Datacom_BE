-- Suggested indexes to improve query performance. Run these in your MySQL client.

CREATE INDEX IF NOT EXISTS idx_caseRepair_created_at ON caseRepair (created_at);
CREATE INDEX IF NOT EXISTS idx_caseRepair_caseStatus ON caseRepair (caseStatus(50));

CREATE INDEX IF NOT EXISTS idx_caseSentRepair_DateSOfSent ON caseSentRepair (DateSOfSent);
CREATE INDEX IF NOT EXISTS idx_caseSentRepair_dateOfReceived ON caseSentRepair (dateOfReceived(10));

CREATE INDEX IF NOT EXISTS idx_caseProject_dateCreate ON caseProject (dateCreate);
CREATE INDEX IF NOT EXISTS idx_caseProject_pStatus ON caseProject (pStatus(50));

-- If pId is not primary/integer, consider adding a numeric auto-increment id for efficient keyset pagination
-- ALTER TABLE caseProject ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY FIRST;

-- Fulltext indexes (optional, improve search on text columns). Only apply if your MySQL supports FULLTEXT on InnoDB.
-- ALTER TABLE caseRepair ADD FULLTEXT idx_caseRepair_search (cusFirstName, cusLastName, caseBrand, caseModel, caseSN, brokenSymptom);
-- ALTER TABLE caseSentRepair ADD FULLTEXT idx_caseSentRepair_search (caseSCusName, caseSToMechanic, caseSOrderNo, caseSSN, brokenSymptom);
