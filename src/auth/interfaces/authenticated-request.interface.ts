import { Request } from 'express';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  admin?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
