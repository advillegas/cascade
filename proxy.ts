import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Protect API mutations + account routes. Game, landing, sign-in/up are public.
const isProtected = createRouteMatcher([
  '/api/score/(.*)',
  '/api/profile(.*)',
  '/account(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
