import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { Account } from "@/lib/account";
 
export const POST = async (req : NextRequest) => {
    const {accountId, userId}=await req.json();
    if(!accountId || !userId){
        return NextResponse.json({error:'accountId and userId are required'}, {status:400});
    }
  const dbAccount= await db.account.findUnique({
    where:{
        id:accountId,
        userId
    }
  });
    if(!dbAccount){
        return NextResponse.json({error:'Account not found'}, {status:404});
    }
    const account=new Account(dbAccount.accessToken);
    const response= await account.performInitialSync();
    if(!response){
        return NextResponse.json({error:'Initial sync failed'}, {status:500});
    }
    const {emails, deltaToken}=response;
    /*await db.account.update({
        where:{
            id:accountId
        },
        data:{
            nextDeltaToken:deltaToken
        }
      
    });*/

    // await syncEmailsToDatabase(emails)
    return NextResponse.json({message:'Initial sync completed', emailCount: emails.length});
}