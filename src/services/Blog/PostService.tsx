import prisma, { Category, Post } from "../../libs/prisma";
import Validator from "../../helpers/Validater";


export default class BlogPostService {

    static async createPost(data: Post): Promise<Post> {

        const { title, content, categoryId, authorId , slug } = data;


        Validator.validateStringField("title", title);
        Validator.validateStringField("content", content);
        Validator.validateStringField("categoryId", categoryId);
        Validator.validateStringField("authorId", authorId);
        Validator.validateStringField("slug", slug);

        const post = await prisma.post.create({
            data: {
                title,
                content,
                categoryId,
                authorId,
                slug,
            },
        });

        return post;
    }

    static async listPosts(page: number, pageSize: number): Promise<Post[]> {

        Validator.validateNaturalNumber(page);
        Validator.validateNaturalNumber(pageSize);

        const posts = await prisma.post.findMany({
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        return posts;
    }

    static async getPostById(id: string): Promise<Post> {

        Validator.validateID(id);

        const post = await prisma.post.findUnique({
            where: {
                postId: id,
            },
        });

        if (!post) {
            throw new Error("POST_NOT_FOUND");
        }

        return post;
    }

    static async updatePost(id: string, data: Post): Promise<Post> {

        const { title, content, categoryId } = data;

        Validator.validateID(id);
        Validator.validateStringField("title", title);
        Validator.validateStringField("content", content);
        Validator.validateStringField("categoryId", categoryId);

        const post = await prisma.post.update({
            where: {
                postId: id,
            },
            data: {
                title,
                content,
                categoryId,
            },
        });

        return post;
    }

    static async deletePost(id: string): Promise<void> {

        Validator.validateStringField("id", id);

        await prisma.post.delete({
            where: {
                postId: id,
            },
        });
    }

    static async listPostsByCategory(id: string, page: number, pageSize: number): Promise<Post[]> {

        Validator.validateID(id);
        Validator.validateNaturalNumber(page);
        Validator.validateNaturalNumber(pageSize);

        const posts = await prisma.post.findMany({
            where: {
                categoryId: id,
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        return posts;
    }

}

