export function validatePayload(struct, payload) {
    const errors = [];

    for (const field of struct) {
        const { name, type, required, length, enum: enumValues } = field;
        const value = payload[name];

        if (required && (value === undefined || value === null || value === '')) {
            errors.push(`${name} is required`);
            continue;
        }

        if (enumValues && !enumValues.includes(value)) {
            errors.push(`${name} must be one of ${enumValues.join(', ')}`);
            continue;
        }

        if (length && typeof value === 'string' && value.length > length) {
            errors.push(`${name} exceeds max length of ${length}`);
        }

        if (type === 'uuid' && value && !/^[0-9a-fA-F-]{36}$/.test(value)) {
            errors.push(`${name} is not a valid UUID`);
        }

        // Add type checks as needed
    }

    return errors;
}
