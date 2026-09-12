ALTER TABLE "User" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "User_publicSlug_key" ON "User"("publicSlug");
