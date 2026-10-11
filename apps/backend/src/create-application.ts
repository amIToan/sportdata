import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import compression from "compression";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { raw } from "express";
import type { NextFunction, Request, Response } from "express";
import { constants as zlibConstants } from "zlib";

export async function configureApplication(app: INestApplication) {
  const isEventStream = (request: Request) => /^\/api\/matches\/event\/[^/]+\/stream$/.test(request.path);
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(
    "/api/system-backup/import/uploads",
    raw({ type: "application/octet-stream", limit: "4mb" }),
  );
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production" ? undefined : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    compression({
      filter: (request, response) => !isEventStream(request) && compression.filter(request, response),
      threshold: 1_024,
      brotli: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } },
    }),
  );
  // app.use(
    // rateLimit({
    //   windowMs: Number(process.env.RATE_LIMIT_TTL_MS || 60_000),
    //   limit: Number(process.env.RATE_LIMIT_REQUESTS || 120),
    //   standardHeaders: "draft-8",
    //   legacyHeaders: false,
    //   skip: (request) =>
    //     request.path === "/api/health/live" ||
    //     request.path === "/api/health/ready",
    // }),
  // );
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isEventStream(request)) {
      response.setHeader("Cache-Control", "no-store, no-transform");
      response.setHeader("Vercel-CDN-Cache-Control", "no-store");
      response.setHeader("X-Accel-Buffering", "no");
      return next();
    }
    const publicGet =
      request.method === "GET" &&
      !request.headers.authorization &&
      /^\/api\/(banners|events|matches|athletes|sports|categories|countries|federations|statistics)(\/|\?|$)/.test(
        request.originalUrl,
      );

    if (publicGet) {
      const isLiveData = request.originalUrl.startsWith("/api/matches");
      const maxAge = isLiveData ? 5 : 30;
      response.setHeader("Cache-Control", `public, max-age=${maxAge}`);
      response.setHeader(
        "Vercel-CDN-Cache-Control",
        `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}`,
      );
      response.vary("Accept-Encoding");
      response.vary("Authorization");
    }
    next();
  });

  const allowedOrigins = (
    process.env.FRONTEND_URLS ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  app.enableCors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/$/, "");
      const isAllowedPreview =
        process.env.ALLOW_VERCEL_PREVIEWS === "true" &&
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin);
      callback(
        null,
        allowedOrigins.includes(normalizedOrigin) || isAllowedPreview,
      );
    },
    credentials: true,
  });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_SWAGGER === "true"
  ) {
    const config = new DocumentBuilder()
      .setTitle("SportData Platform API")
      .setDescription(
        "API for managing sports events, athletes, matches, and statistics",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  return app;
}
