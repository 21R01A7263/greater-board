import React from "react";

export const Logo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
);


{/* <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="412"
      height="512"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 5 4 2 4-6 6 12H4L9 3z" />
    </svg> */}