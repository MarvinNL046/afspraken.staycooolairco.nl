declare module 'csrf-csrf' {
  export interface CSRFOptions {
    getTokenFromRequest: (req: any) => string | null;
  }

  export class CSRF {
    constructor(options?: CSRFOptions);
    generateToken(params: { secret: string; sessionId: string }): string;
    verifyToken(params: { secret: string; sessionId: string; token: string }): boolean;
  }
}