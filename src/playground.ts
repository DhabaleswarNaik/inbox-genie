import { db } from "./server/db";

await db.user.create({
    data: {

        emailAddress: "omnaik@example.com",
        firstName: "Om",
        lastName: "Naik",
    },
});
console.log("User created");