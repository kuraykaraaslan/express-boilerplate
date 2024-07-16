import { AuthConfig as AuthConfigType } from "@auth/core"
import { PrismaAdapter } from "@auth/prisma-adapter"
import  PrismaClient from "../libs/prisma/client"
import Google from "@auth/express/providers/google"

const AuthConfig : AuthConfigType = { 
    
    adapter: PrismaAdapter(PrismaClient),
    providers: [
        Google({
          authorization: {
            params: {
              prompt: "consent",
              access_type: "offline",
              response_type: "code",
            },
          },
        }),
      ],
}

export default AuthConfig

