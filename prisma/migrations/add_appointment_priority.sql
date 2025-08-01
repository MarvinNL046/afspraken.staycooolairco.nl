-- Add prioriteit column to afspraken table
ALTER TABLE afspraken 
ADD COLUMN IF NOT EXISTS prioriteit INTEGER DEFAULT 0;

-- Add comment to explain priority levels
COMMENT ON COLUMN afspraken.prioriteit IS '0=normaal, 1=hoog, 2=urgent';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_afspraken_prioriteit 
ON afspraken(prioriteit);

-- Update existing appointments to have default priority
UPDATE afspraken 
SET prioriteit = 0 
WHERE prioriteit IS NULL;