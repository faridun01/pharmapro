type ProductDisplayInput = {
  name?: string | null;
  manufacturer?: string | null;
  countryOfOrigin?: string | null;
};

type ProductDisplayOptions = {
  includeManufacturer?: boolean;
  includeCountry?: boolean;
};

const normalizePart = (value: string | null | undefined) => String(value || '').trim();

export const formatProductDisplayName = (
  product: ProductDisplayInput,
  options: ProductDisplayOptions = {},
) => {
  const name = normalizePart(product.name) || '-';
  const manufacturer = normalizePart(product.manufacturer);
  const countryOfOrigin = normalizePart(product.countryOfOrigin);
  const extras: string[] = [];

  if (options.includeManufacturer && manufacturer) {
    extras.push(manufacturer);
  }

  if (options.includeCountry && countryOfOrigin) {
    extras.push(countryOfOrigin);
  }

  if (extras.length === 0) {
    return name;
  }

  return `${name} • ${extras.join(' • ')}`;
};