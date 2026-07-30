-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyName" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT,
    "backfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipping" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vendor" TEXT,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "originalInvoice" TEXT,
    "paymentState" TEXT,
    "deliveryCountry" TEXT,
    "totalNet" DOUBLE PRECISION,
    "shipping" DOUBLE PRECISION,
    "charges" DOUBLE PRECISION,
    "vat" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "outsideScopeOfTax" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "qty" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SupplierInvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "Order_shop_idx" ON "Order"("shop");

-- CreateIndex
CREATE INDEX "Order_shop_paidAt_idx" ON "Order"("shop", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shop_shopifyOrderId_key" ON "Order"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_orderId_idx" ON "OrderLineItem"("orderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_shop_idx" ON "SupplierInvoice"("shop");

-- CreateIndex
CREATE INDEX "SupplierInvoice_shop_date_idx" ON "SupplierInvoice"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_shop_docNumber_key" ON "SupplierInvoice"("shop", "docNumber");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLineItem_invoiceId_idx" ON "SupplierInvoiceLineItem"("invoiceId");

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLineItem" ADD CONSTRAINT "SupplierInvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
