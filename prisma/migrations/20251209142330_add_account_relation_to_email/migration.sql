/*
  Warnings:

  - Added the required column `accountId` to the `Email` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "accountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "_BccEmails" ADD CONSTRAINT "_BccEmails_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_BccEmails_AB_unique";

-- AlterTable
ALTER TABLE "_CcEmails" ADD CONSTRAINT "_CcEmails_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_CcEmails_AB_unique";

-- AlterTable
ALTER TABLE "_ReplyToEmails" ADD CONSTRAINT "_ReplyToEmails_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ReplyToEmails_AB_unique";

-- AlterTable
ALTER TABLE "_ToEmails" ADD CONSTRAINT "_ToEmails_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ToEmails_AB_unique";

-- CreateIndex
CREATE INDEX "Email_accountId_idx" ON "Email"("accountId");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
