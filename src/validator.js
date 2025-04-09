export function validatePayload(struct, payload, options = {}) {
    const errors = [];

    for (const field of struct) {
        const value = payload[field.name];
        const isAuto = field.default === 'auto_increment';
        const skipAuto = options.skipAutoIncrement && isAuto;

        // Prevent user from passing an auto_increment value on insert
        if (skipAuto && value !== undefined) {
            errors.push(`${field.name} should not be provided (auto_increment)`);
            continue;
        }

        if (skipAuto) continue;

        if (field.required && (value === undefined || value === null || value === '')) {
            errors.push(`${field.name} is required`);
            continue;
        }

        if (field.type === 'number' && value !== undefined && isNaN(Number(value))) {
            errors.push(`${field.name} must be a number`);
        }

        if (field.enum && !field.enum.includes(value)) {
            errors.push(`${field.name} must be one of ${field.enum.join(', ')}`);
        }

        if (field.length && typeof value === 'string' && field.length > 0 && value.length > field.length) {
            errors.push(`${field.name} exceeds max length of ${field.length}`);
        }
    }

    return errors;
}
