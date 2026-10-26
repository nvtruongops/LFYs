declare global {
  namespace App {
    interface Locals {
      session: typeof import('./lib/server/auth').auth.$Infer.Session['session'] | null;
      user: typeof import('./lib/server/auth').auth.$Infer.Session['user'] | null;
    }
  }
}

export {};
