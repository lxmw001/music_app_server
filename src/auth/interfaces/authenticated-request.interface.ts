import { Request } from 'express';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  admin?: boolean;
  isPremium?: boolean;
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
