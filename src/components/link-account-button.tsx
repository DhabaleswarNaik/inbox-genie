'use client'
import {Button} from "@/components/ui/button";
import { getAurinkoAuthUrl } from "@/lib/aurinko";
import React from "react";

const LinkAccountButton =()=> {
    return (
        <Button 
             onClick={async ()=>{
            const googleAuthUrl = await getAurinkoAuthUrl('Google');
            const office365AuthUrl = await getAurinkoAuthUrl('Office365');
            
            window.location.href = googleAuthUrl;
            //window.location.href = office365AuthUrl;
            
        }}>
            Link Account
         </Button>
    );
}

export default LinkAccountButton;