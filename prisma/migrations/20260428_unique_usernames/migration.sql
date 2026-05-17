ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "username" TEXT;

UPDATE "public"."User" AS u
SET "username" = NULL
WHERE u."username" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "public"."User" AS older
    WHERE lower(older."username") = lower(u."username")
      AND (
        older."createdAt" < u."createdAt"
        OR (older."createdAt" = u."createdAt" AND older."id" < u."id")
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "public"."User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_lower_key" ON "public"."User"(lower("username"));
