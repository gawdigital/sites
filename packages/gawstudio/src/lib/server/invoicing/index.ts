// Invoicing for the studio's orders: the provider interface, the Fakturoid adapter behind it, the token handling
// the adapter needs, and the fake for other modules' tests.
export type {
  Address,
  Company,
  CorrectionInput,
  Currency,
  CustomerRef,
  DocumentDraft,
  DocumentKind,
  InvoiceCustomer,
  InvoiceDocument,
  InvoiceInput,
  InvoiceLanguage,
  InvoiceLine,
  InvoicingError,
  InvoicingProvider,
  IsoDate,
  Issued,
  Money,
  PaymentInput,
  PaymentMethod,
  PaymentResult,
  PriceMode,
  Result,
} from './types.ts';
export { fail, ok } from './types.ts';
export { expectedTotal, fromDecimal, isCurrency, toDecimal } from './money.ts';
export { createTokenSource, MemoryTokenCache, type TokenCache, type TokenConfig, type TokenSource } from './token.ts';
export { createFakturoid, type FakturoidConfig } from './fakturoid.ts';
export { FakeInvoicing, totalOf, type FakeDocument, type InvoicingCall } from './fake.ts';
