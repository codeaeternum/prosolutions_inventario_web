-- Estado de cuenta público del cliente: link firmado por token (/cuenta/<token>)
-- para consultar saldo, movimientos de crédito y apartados sin login.
ALTER TABLE "User"
  ADD COLUMN "statementToken" TEXT,
  ADD COLUMN "statementTokenExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_statementToken_key" ON "User"("statementToken");
