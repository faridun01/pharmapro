const DAY_MS = 24 * 60 * 60 * 1000;

export const buildDueDateFromTerm = (baseDate: Date, paymentTermDays?: number | null) => {
  const termDays = Number(paymentTermDays ?? 0);
  if (!Number.isFinite(termDays) || termDays <= 0) {
    return null;
  }

  return new Date(baseDate.getTime() + termDays * DAY_MS);
};

export const resolveCustomerDueDate = async (
  tx: any,
  customerId: string,
  baseDate: Date,
) => {
  if (!customerId) {
    return null;
  }

  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { paymentTermDays: true },
  });

  return buildDueDateFromTerm(baseDate, customer?.paymentTermDays);
};