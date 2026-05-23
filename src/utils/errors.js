import Logger from './logger.js';

// Custom error classes for better error handling
export class ValidationError extends Error {
    constructor(message, field = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
    }
}

export class DatabaseError extends Error {
    constructor(message, operation = null) {
        super(message);
        this.name = 'DatabaseError';
        this.operation = operation;
    }
}

export class ServiceError extends Error {
    constructor(message, service = null) {
        super(message);
        this.name = 'ServiceError';
        this.service = service;
    }
}

// Standardized error handling wrapper
export const withErrorHandling = (operation, context = '') => {
    return async (...args) => {
        try {
            return await operation(...args);
        } catch (error) {
            Logger.error(`${context} failed: ${error.message}`, error);

            // Re-throw typed errors as-is. `instanceof` is more robust than the
            // prior `error.name === '...'` check: subclasses are preserved, and
            // a third-party error that happens to set `name = 'ValidationError'`
            // can no longer slip through unwrapped.
            if (
                error instanceof ValidationError ||
                error instanceof DatabaseError ||
                error instanceof ServiceError
            ) {
                throw error;
            }

            // Wrap unknown errors
            throw new ServiceError(error.message, context);
        }
    };
};

// Validation utilities
export const validateRequired = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        throw new ValidationError(`${fieldName} is required`, fieldName);
    }
};

export const validateArray = (value, fieldName) => {
    validateRequired(value, fieldName);
    if (!Array.isArray(value)) {
        throw new ValidationError(`${fieldName} must be an array`, fieldName);
    }
};

export const validateNumber = (value, fieldName, min = null, max = null) => {
    validateRequired(value, fieldName);
    const num = Number(value);
    if (isNaN(num)) {
        throw new ValidationError(`${fieldName} must be a valid number`, fieldName);
    }
    if (min !== null && num < min) {
        throw new ValidationError(`${fieldName} must be at least ${min}`, fieldName);
    }
    if (max !== null && num > max) {
        throw new ValidationError(`${fieldName} must be at most ${max}`, fieldName);
    }
    return num;
};
