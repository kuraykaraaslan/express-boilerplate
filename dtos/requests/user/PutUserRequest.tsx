import FieldValidater from "@/utils/FieldValidater";

import { User } from "@prisma/client";

export default interface PutUserRequest extends Omit<User, "password"> {}