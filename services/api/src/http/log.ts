import type { NextFunction, Request, Response } from "express";

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  if (!path.startsWith("/api/") || path === "/api/health") return next();
  const started = performance.now();
  res.on("finish", () => {
    const line = {
      t: new Date().toISOString(),
      method: req.method,
      path,
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
      country: req.get("cf-ipcountry") ?? null,
      ...res.locals.log,
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  });
  next();
}
