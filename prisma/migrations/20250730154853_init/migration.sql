-- CreateEnum
CREATE TYPE "public"."AppointmentStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "public"."ServiceType" AS ENUM ('installation', 'maintenance', 'repair', 'consultation');

-- CreateEnum
CREATE TYPE "public"."CustomerType" AS ENUM ('residential', 'business');

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "company" TEXT,
    "customer_type" "public"."CustomerType" NOT NULL DEFAULT 'residential',
    "address" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."appointments" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "service_type" "public"."ServiceType" NOT NULL,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "scheduled_time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 120,
    "status" "public"."AppointmentStatus" NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "internal_notes" TEXT,
    "google_event_id" TEXT,
    "ghl_contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."time_slots" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "max_appointments" INTEGER NOT NULL DEFAULT 1,
    "current_bookings" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."blocked_dates" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "public"."customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_google_event_id_key" ON "public"."appointments"("google_event_id");

-- CreateIndex
CREATE INDEX "appointments_scheduled_date_status_idx" ON "public"."appointments"("scheduled_date", "status");

-- CreateIndex
CREATE INDEX "appointments_customer_id_idx" ON "public"."appointments"("customer_id");

-- CreateIndex
CREATE INDEX "time_slots_date_is_available_idx" ON "public"."time_slots"("date", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "time_slots_date_start_time_key" ON "public"."time_slots"("date", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_dates_date_key" ON "public"."blocked_dates"("date");

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
