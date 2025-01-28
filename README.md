# Express Boilerplate

![express](/public/logo.png)

This project is a boilerplate for building a web application using Express.js. It includes TypeScript for static typing, Prisma as an ORM, and various utilities to enhance the development process.

## Features
- **Clean Architecture**: A clean, scalable architecture for building web applications.
- **Api Versioning**: Versioning the API endpoints for better control and maintenance.
- **Authentication**: User authentication using JWT.
- **Error Handling**: Centralized error handling.
- **Prisma ORM**: Database access using Prisma.
- **TypeScript**: Static typing for JavaScript.
- **Validation**: Request validation using Validator.
- **Environment Variables**: Environment variables using dotenv.


## Screenshots

![screenshot](/public/screenshot.png)

## Table of Contents

- [Express Boilerplate](#express-boilerplate)
  - [Features](#features)
  - [Screenshots](#screenshots)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Certification](#certification)
  - [Usage](#usage)
  - [Services](#services)
  - [Roadmap](#roadmap)
  - [Development](#development)
  - [Dependencies](#dependencies)
  - [Postman Collection](#postman-collection)
  - [License](#license)
  - [Support](#support)
  - [Donate](#donate)
  - [Hire Me](#hire-me)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/kuraykaraaslan/express-boilerplate.git
   cd express-boilerplate
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your environment variables:
   Create a `.env` file in the root directory and add your environment variables (e.g., database connection string).

## Certification

To generate a self-signed SSL certificate for local development:

1. Update the `req.cnf` file with your information.
2. Run the following command:

   ```bash
   npm run cert
   ```
3. The certificate and key files will be generated in the `certs` directory.

## Usage

To start the application in development mode:

```bash
npm run dev # or `npm run start`
```

## Services

The following services are available:

- Authentication
- Users
- Tenants
- Tenant Members

## Roadmap

- [x] Add Prisma ORM
- [x] Add User authentication
- [x] Add Controllers
- [x] Add API versioning
- [x] Add Request validation
- [x] Add Tenancy support
- [x] Add Docker support
- [ ] Add unit tests
- [x] Add logging
- [x] Add error handling
- [ ] Better documentation
- [x] Add Twillo Service
- [x] Add Mail Service
- [x] Add rate limiting

## Development

To build the application:

```bash
npm run build
```

To run the application in production mode:

```bash
npm run start
```

## Dependencies

- [Express](https://expressjs.com/)
- [Prisma](https://www.prisma.io/)
- [TypeScript](https://www.typescriptlang.org/)
- [dotenv](https://www.npmjs.com/package/dotenv)
- [morgan](https://www.npmjs.com/package/morgan)
- [nodemon](https://www.npmjs.com/package/nodemon)

## Postman Collection

You can import the Postman collection from the following link:

[![Run in Postman](https://run.pstmn.io/button.svg)](/static/V1.postman_collection.json)

## License

Diplomat is licensed under the MIT license. See [LICENSE](/LICENSE) for more information.

## Support

If you have any questions or need help with customizing the template, feel free to reach out to me on [Twitter](https://twitter.com/kuraykaraaslan) or [GitHub](https://github.com/kuraykaraaslan).

## Donate

If you like the template and want to support my work, you can buy me a coffee:

<a href="https://www.buymeacoffee.com/kuraykaraaslan" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

<a href="https://www.patreon.com/kuraykaraaslan" target="_blank"><img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Become a Patron!" style="height: 60px !important;width: 217px !important;" ></a>

## Hire Me

If you need help with your next project, feel free to reach out to me. I'm available for freelance work.
