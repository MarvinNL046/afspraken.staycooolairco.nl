-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "lead_id" TEXT,
    "payload" JSON NOT NULL,
    "processed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "is_processed" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "processing_time_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_idx" ON "webhook_events"("event_type");

-- CreateIndex
CREATE INDEX "webhook_events_source_idx" ON "webhook_events"("source");

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events"("processed_at");

-- CreateIndex
CREATE INDEX "webhook_events_is_processed_idx" ON "webhook_events"("is_processed");

-- CreateIndex
CREATE INDEX "webhook_events_lead_id_idx" ON "webhook_events"("lead_id");

-- Add additional fields to leads table for better webhook integration
ALTER TABLE "leads" ADD COLUMN "tags" JSON;
ALTER TABLE "leads" ADD COLUMN "custom_fields" JSON;
ALTER TABLE "leads" ADD COLUMN "last_webhook_event_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_bron_systeem_idx" ON "leads"("bron_systeem");

-- CreateIndex  
CREATE INDEX "leads_last_contact_at_idx" ON "leads"("last_contact_at");

-- CreateIndex
CREATE INDEX "leads_is_in_service_area_idx" ON "leads"("is_in_service_area");