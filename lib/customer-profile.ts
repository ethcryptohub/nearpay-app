export type CustomerProfile = {
  name: string;
  email: string;
  mobile: string;
};

export const emptyCustomerProfile: CustomerProfile = {
  name: "",
  email: "",
  mobile: "",
};

export function customerProfileStorageKey(accountId: string): string {
  return `nearpay_customer_profile:${accountId}`;
}

export function parseCustomerProfile(value: string | null): CustomerProfile {
  if (!value) {
    return emptyCustomerProfile;
  }

  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    typeof parsed.name !== "string" ||
    !("email" in parsed) ||
    typeof parsed.email !== "string" ||
    !("mobile" in parsed) ||
    typeof parsed.mobile !== "string"
  ) {
    throw new Error("Saved customer profile has an invalid format.");
  }

  return {
    name: parsed.name,
    email: parsed.email,
    mobile: parsed.mobile,
  };
}

export function validateCustomerProfile(
  profile: CustomerProfile,
): string | null {
  const name = profile.name.trim();
  const email = profile.email.trim();
  const mobile = profile.mobile.trim();

  if (!name || name.length > 100) {
    return "Enter your name (up to 100 characters).";
  }
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return "Enter a valid email address.";
  }
  if (
    mobile.length > 24 ||
    !/^\+?[0-9][0-9\s()-]{6,22}$/.test(mobile)
  ) {
    return "Enter a valid mobile number with country code if needed.";
  }
  return null;
}
