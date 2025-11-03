import { NextRequest, NextResponse } from "next/server";
import {auth} from "@clerk/nextjs/server";
import { exchangeCodeForAccessToken } from "@/lib/aurinko";
import { getAccountDetails } from "@/lib/aurinko"; 
import { db } from "@/server/db";
export const GET = async (req : NextRequest) => {
    const {userId}=await auth()
    if(!userId) return NextResponse.json({message:'Unauthorized'}, {status:401});
    const params=req.nextUrl.searchParams;
    const status=params.get('status');
    if(status !== 'success'){
        return NextResponse.json({message:'Failed to link account'}, {status:400});
    }
    const code=params.get('code');
    if(!code){return NextResponse.json({message:'Code not provided'}, {status:400});}
    const token= await exchangeCodeForAccessToken(code);
    if(!token){
        return NextResponse.json({message:'Failed to exchange code for token'}, {status:500});
    }
    const accountDetails = await getAccountDetails(token.accessToken)
    await db.account.upsert({
        where:{
            id:token.accountId.toString()
        },
        update:{
            accessToken: token.accessToken,
        },
        create: {
            id: token.accountId.toString(),
            userId,
            emailAddress: accountDetails.email,
            name: accountDetails.name,
            accessToken: token.accessToken
        }
    })
    return NextResponse.redirect(new URL('/mail', req.url));
}