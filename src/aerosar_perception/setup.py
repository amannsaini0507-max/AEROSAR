from setuptools import find_packages, setup

package_name = 'aerosar_perception'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='arun07',
    maintainer_email='arun07@todo.todo',
    description='TODO: Package description',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'perception_node = aerosar_perception.perception_node:main',
            'hazard_node = aerosar_perception.hazard_node:main',
	    'fusion_node = aerosar_perception.fusion_node:main',
        ],
    },
)
