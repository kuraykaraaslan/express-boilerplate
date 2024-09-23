import prisma, { Category, Post } from "../../libs/prisma";
import Validator from "../../helpers/Validater";


export default class CategoryService {
    static async createCategory(data: Category): Promise<Category> {

        const { name, slug, description } = data;

        if (!name || !slug || !description) {
            throw new Error("INVALID_DATA");
        }

        Validator.validateStringField("name", name);
        Validator.validateStringField("slug", slug);
        Validator.validateStringField("description", description as string, true);

        const category = await prisma.category.create({
            data: {
                name,
                slug,
                description,
            },
        });

        return category;
    }

    static async listCategories(page: number, pageSize: number): Promise<Category[]> {

        Validator.validateNaturalNumber(page);
        Validator.validateNaturalNumber(pageSize);

        const categories = await prisma.category.findMany({
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        return categories;
    }

    static async getCategoryById(id: string): Promise<Category> {

        Validator.validateStringField("id", id);

        const category = await prisma.category.findUnique({
            where: {
                categoryId: id,
            },
        });
        
        if (!category) {
            throw new Error("CATEGORY_NOT_FOUND");
        }

        return category;
    }

    static async updateCategory(id: string, data: Category): Promise<Category> {

        const { name, slug, description } = data;

        Validator.validateStringField("id", id);
        Validator.validateStringField("name", name);
        Validator.validateStringField("slug", slug);
        Validator.validateStringField("description", description as string, true);

        const category = await prisma.category.update({
            where: {
                categoryId: id,
            },
            data: {
                name,
                slug,
                description,
            },
        });

        return category;
    }

    static async deleteCategory(id: string): Promise<Category> {

        Validator.validateStringField("id", id);

        const category = await prisma.category.delete({
            where: {
                categoryId: id,
            },
        });

        return category;
    }

    static async getPostsByCategory(categoryId: string, page: number, pageSize: number): Promise<Post[]> {

        Validator.validateStringField("categoryId", categoryId);
        Validator.validateNaturalNumber(page);
        Validator.validateNaturalNumber(pageSize);

        const posts = await prisma.post.findMany({
            where: {
                categoryId,
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        return posts;
    }

    static async getPostsCountByCategory(categoryId: string): Promise<number> {

        Validator.validateStringField("categoryId", categoryId);

        const count = await prisma.post.count({
            where: {
                categoryId,
            },
        });

        return count;
    }
}

