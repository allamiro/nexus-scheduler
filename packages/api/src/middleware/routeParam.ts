import type { Request } from "express";

// Express 5's ParamsDictionary types every param as `string | string[]`
// because path-to-regexp v8 supports repeatable params (e.g. "/:ids+").
// No route in this package uses that pattern — a named ":param" segment
// is always a plain string at runtime. This helper narrows accordingly
// for middleware that read params without a route-path literal to infer
// from (asyncHandler-wrapped inline handlers get the narrow type for
// free via RouteParameters inference).
export function routeParam(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
