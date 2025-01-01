import { User } from "@prisma/client";

export default interface OmitPasswordUserResponse extends Omit<User, "password"> {}