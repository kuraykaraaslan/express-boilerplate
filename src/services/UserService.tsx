import prisma, { User }  from "../libs/prisma";
import bcrypt from "bcrypt";
import AuthService from "./AuthService";

import Validater from "../helpers/Validater";



export default class UserService {

  // Link to AuthService static methods
  static checkIfUserHasRole = AuthService.checkIfUserHasRole;

  
  static listAllUsers(page: number, pageSize: number): Promise<any> {

    Validater.validateNaturalNumber(page);
    Validater.validateNaturalNumber(pageSize);

    return prisma
      .$transaction([
        prisma.user.findMany({
          skip: page * pageSize,
          take: pageSize,
          select: {
            userId: true,
            email: true,
            verified: true,
            roles: true,
            phone: true,
            avatar: true,
          },
        }),
        prisma.user.count(),
      ])
      .then((query) => {
        return {
          users: query[0],
          total: query[1],
          page,
          pageSize,
        };
      });
  }

  static async createUser(email: string, password: string): Promise<User> {

    Validater.validateEmail(email);
    Validater.validatePassword(password);

    const hashedPassword = await bcrypt.hash(password, 10);
    return prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        verified: true,
        roles: ["USER"],
      },
    });
  }

  static async getUserByEmail(email: string): Promise<User> {

    Validater.validateEmail(email);

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        userId: true,
        email: true,
        password: true,
        verified: true,
        roles: true,
      },
    });

    return user as User;
  }

  static async getUserById(userId: string): Promise<User> {

    Validater.validateID(userId);

    const user = await prisma.user.findUnique({
      where: {
        userId,
      },
      select: {
        userId: true,
        email: true,
        password: true,
        verified: true,
        roles: true,
      },
    });

    return user as User;
  }

  static async addRoles(userId: string, roles: string[]): Promise<void> {

    Validater.validateID(userId);
    Validater.validateRoles(roles);

    const user = await prisma.user.findUnique({
      where: {
        userId,
      },
    });

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    //roles should be ['USER', 'ADMIN', 'SYSTEM_ADMIN']
    const rolesArray = user.roles ? user.roles : [];

    for (const role of roles) {
      if (!rolesArray.includes(role as string)) {
        rolesArray.push(role as string);
      }
    }

    await prisma.user.update({
      where: {
        userId,
      },
      data: {
        roles: rolesArray,
      },
    });
  }

  static async removeRoles(userId: string, roles: string[]): Promise<void> {

    Validater.validateID(userId);
    Validater.validateRoles(roles);

    const user = await prisma.user.findUnique({
      where: {
        userId,
      },
    });

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    //roles should be ['USER', 'ADMIN', 'SYSTEM_ADMIN']
    let rolesArray = user.roles ? user.roles : [];

    for (const role of roles) {
      if (rolesArray.includes(role as string)) {
        rolesArray = rolesArray.filter((r) => r !== role);
      }
    }

    // USER role is mandatory for all users
    if (!rolesArray.includes("USER")) {
      rolesArray.push("USER");
    }

    await prisma.user.update({
      where: {
        userId,
      },
      data: {
        roles: rolesArray,
      },
    });
  }

  static async deleteUser(userId: string): Promise<void> {

    Validater.validateID(userId);

    await prisma.user.delete({
      where: {
        userId,
      },
    });
  }

}
