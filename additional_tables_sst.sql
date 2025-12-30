-- Tablas adicionales que podrían no existir en la base de datos del Servicio de Salud (SST).
-- Ejecute este script en la consola SQL de Supabase únicamente en el proyecto SST.
-- Utiliza `CREATE TABLE IF NOT EXISTS` para evitar errores si una tabla ya existe.

-- Llegadas de insumos (registro de recepciones de compras al Servicio)
CREATE TABLE IF NOT EXISTS public.supply_arrivals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    arrival_date date NOT NULL,
    supply_id uuid REFERENCES public.supplies(id) ON DELETE SET NULL,
    quantity_arrived numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

-- Convenios de retiro de residuos con proveedores externos
CREATE TABLE IF NOT EXISTS public.waste_removal_agreements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social text NOT NULL,
    rut_proveedor text,
    licitacion_id text,
    price_per_kg_special_iva numeric,
    price_per_kg_hazardous_iva numeric,
    start_date date,
    end_date date,
    status text,
    created_at timestamp with time zone DEFAULT now()
);

-- Facturas mensuales asociadas a convenios de retiro de residuos
CREATE TABLE IF NOT EXISTS public.monthly_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_number text,
    agreement_id uuid REFERENCES public.waste_removal_agreements(id) ON DELETE SET NULL,
    billing_cycle_start date,
    billing_cycle_end date,
    pre_invoice_kg_special numeric,
    pre_invoice_kg_hazardous numeric,
    pre_invoice_amount_iva numeric,
    status text,
    created_at timestamp with time zone DEFAULT now()
);

-- Retiros de residuos acordados con empresas (incluye guías como JSON)
CREATE TABLE IF NOT EXISTS public.waste_pickups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pickup_date date NOT NULL,
    agreement_id uuid REFERENCES public.waste_removal_agreements(id) ON DELETE SET NULL,
    guides jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);