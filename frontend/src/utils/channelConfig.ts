/** Normalize legacy config shapes into form-friendly values */
export function normalizeChannelConfig(
  channelType: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const config = { ...raw };

  if (channelType === "email") {
    if (!config.addresses && (config.address || config.email)) {
      const single = String(config.address || config.email);
      config.addresses = single ? [single] : [];
    }
    if (!Array.isArray(config.addresses)) {
      config.addresses = config.addresses ? [String(config.addresses)] : [];
    }
    config.addresses = configStringList(config, "addresses");
  }

  if (channelType === "signal" || channelType === "whatsapp") {
    if (!config.phone && config.number) config.phone = config.number;
    if (!config.phone_number && config.phone) config.phone_number = config.phone;
  }

  if (channelType === "twilio_voice" || channelType === "twilio_sms") {
    if (!config.phone_numbers) {
      const legacy =
        configString(config, "phone_number") || configString(config, "number");
      config.phone_numbers = legacy ? [legacy] : [];
    }
    if (!Array.isArray(config.phone_numbers)) {
      config.phone_numbers = configStringList(config, "phone_numbers");
    } else {
      config.phone_numbers = config.phone_numbers.map(String).filter(Boolean);
    }
    if (!config.phone_number && config.phone_numbers[0]) {
      config.phone_number = config.phone_numbers[0];
    }
    if (!config.number && config.phone_numbers[0]) {
      config.number = config.phone_numbers[0];
    }
  }

  if (channelType === "telegram" && config.allow_from && typeof config.allow_from === "string") {
    // keep as string in textarea
  }

  return config;
}

export function configString(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  if (v === undefined || v === null) return "";
  return String(v);
}

export function configBool(config: Record<string, unknown>, key: string): boolean {
  return Boolean(config[key]);
}

export function configStringList(config: Record<string, unknown>, key: string): string[] {
  const v = config[key];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** List values for form editors — keeps empty rows while user adds entries. */
export function configFormList(config: Record<string, unknown>, key: string): string[] {
  const v = config[key];
  if (Array.isArray(v)) {
    return v.map((item) => (item === null || item === undefined ? "" : String(item)));
  }
  if (typeof v === "string" && v.trim()) {
    return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** Set primary number and keep phone_numbers[0] in sync (Twilio multi-line). */
export function syncPrimaryPhoneNumber(
  config: Record<string, unknown>,
  number: string,
  listKey = "phone_numbers",
): Record<string, unknown> {
  let next = patchConfig(config, "phone_number", number);
  next = patchConfig(next, "number", number);
  const list = configStringList(next, listKey);
  const nums = [...list];
  if (number) {
    if (nums.length === 0) nums.push(number);
    else nums[0] = number;
  }
  return patchConfig(next, listKey, nums.filter(Boolean));
}

export function patchConfig(
  config: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...config };
  if (value === "" || value === null || value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

/** Flatten email_list + legacy address into stored config */
export function finalizeChannelConfig(
  channelType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...config };

  if (channelType === "email") {
    const addresses = configStringList(out, "addresses");
    out.addresses = addresses;
    if (addresses[0]) out.address = addresses[0];
    delete out.email;
  }

  if (channelType === "signal" || channelType === "whatsapp") {
    const phone = configString(out, "phone") || configString(out, "phone_number");
    if (phone) {
      out.phone = phone;
      out.number = phone;
    }
  }

  if (channelType === "twilio_voice" || channelType === "twilio_sms") {
    const phoneNumbers = configStringList(out, "phone_numbers");
    out.phone_numbers = phoneNumbers;
    if (phoneNumbers[0]) {
      out.phone_number = phoneNumbers[0];
      out.number = phoneNumbers[0];
    } else {
      delete out.phone_number;
      delete out.number;
    }
  }

  return out;
}
