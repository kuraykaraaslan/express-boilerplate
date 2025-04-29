import app from './index';

const port = process.env.PORT || process.env.APPLICATION_PORT || 3002;

app.listen(port, () => {
    console.log(`Server started at port ${port}`);
});

