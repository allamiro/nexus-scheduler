import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 never forwards a rejected async handler's promise to
// next(err)/errorHandler.ts on its own — an unexpected error inside a
// plain `async (req, res) => {...}` route becomes an unhandled promise
// rejection instead (which can crash the whole process, depending on
// Node's --unhandled-rejections mode, and otherwise just leaves the
// request hanging with no response ever sent). Every async
// route/middleware handler in this package is wrapped in this so its
// errors actually reach errorHandler.ts.
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}
