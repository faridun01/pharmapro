import { ValidationError } from './errors';

export const MIN_PASSWORD_LENGTH = 8;

export const validatePassword = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
};
